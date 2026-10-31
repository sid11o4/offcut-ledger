-- Manual Bill / Payment Slip -- the supplier-side (accounts payable) system (business context
-- + a photographed sample slip from the factory owner, Oct 2026). This is a SEPARATE concept
-- from public.bills (Factory's own client job-work billing, accounts receivable) -- a supplier
-- bill is money going OUT for a purchase, never money coming in.
--
-- Core rules from the spec, enforced here:
--  * Every rate entered is GST-inclusive; GST is reverse-calculated PER LINE ITEM
--    independently (never one rate for the whole bill) -- see gst.js-equivalent logic in the
--    trigger below. taxable_value = inclusive amount / (1 + gst% / 100).
--  * A bill posts its expense exactly once, at approval -- see supplier_bills.status below;
--    payments (0032) only ever reduce what's owed, never create a second expense.
--  * A bill can carry more than one cost head (Factory Labour, Site Labour, Raw Boards, ...)
--    without double-counting -- stored as an array on the header, not duplicated per line.

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  internal_bill_number text not null unique, -- the number written on the paper slip (Bill No.)
  bill_date date not null,
  supplier_id uuid references public.suppliers(id), -- nullable while unidentified, pending review
  supplier_text text, -- the name as written/read, before/absent a confident supplier match
  design_project_id uuid references public.design_projects(id), -- null = Factory's own expense
  expense_nature text not null check (expense_nature in ('material','labour','both')),
  cost_heads text[] not null default '{}',
  constraint chk_cost_heads_valid check (
    cost_heads <@ array['factory_labour','factory_consumables','site_labour','raw_boards',
                         'laminate_veneer','fevicol_adhesives','employee_salary','other']::text[]
  ),
  subtotal numeric(14,2) not null default 0, -- sum of line taxable values
  tax_amount numeric(14,2) not null default 0, -- sum of line GST amounts
  grand_total numeric(14,2) not null default 0, -- subtotal + tax_amount, GST-inclusive
  amount_in_words text,
  remarks text,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','void')),
  scan_image_path text,
  field_confidence jsonb not null default '{}', -- { "supplier_name": 0.98, "bill_date": 0.99, ... }
  prepared_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text
);
create index idx_supplier_bills_supplier on public.supplier_bills(supplier_id);
create index idx_supplier_bills_project on public.supplier_bills(design_project_id);
create index idx_supplier_bills_status on public.supplier_bills(status);
create trigger trg_supplier_bills_updated_at before update on public.supplier_bills
  for each row execute function public.set_updated_at();

create table public.supplier_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.supplier_bills(id) on delete cascade,
  description text not null,
  description_text text, -- as read/entered, before a confident inventory-item match
  item_type text not null check (item_type in ('material','labour')),
  inventory_item_id uuid references public.inventory_items(id), -- material lines only, once matched
  unit_text text,
  quantity numeric(14,4) not null check (quantity > 0),
  rate_inclusive numeric(14,4) not null check (rate_inclusive >= 0), -- GST-inclusive, per spec
  gst_percent numeric(5,2) not null default 0 check (gst_percent >= 0),
  -- A 0% line must stay distinguishable: zero-rated / exempt / nil-rated / non-GST are not
  -- interchangeable, even though none of them add tax.
  zero_gst_reason text check (zero_gst_reason in ('zero_rated','exempt','nil_rated','non_gst')),
  constraint chk_zero_gst_reason check (
    (gst_percent > 0 and zero_gst_reason is null) or (gst_percent = 0)
  ),
  taxable_value numeric(14,2) not null default 0, -- reverse-calculated, this line only
  gst_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0, -- quantity * rate_inclusive
  field_confidence jsonb not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_supplier_bill_items_bill on public.supplier_bill_items(bill_id);
create index idx_supplier_bill_items_inventory_item on public.supplier_bill_items(inventory_item_id);

-- Reverse-calculates this line's GST from its GST-inclusive rate, independently of every
-- other line on the same bill (mixed rates on one bill are normal and expected).
create or replace function public.supplier_bill_items_calc()
returns trigger language plpgsql as $$
declare
  v_total numeric;
  v_taxable numeric;
begin
  v_total := round(new.quantity * new.rate_inclusive, 2);
  v_taxable := round(v_total / (1 + new.gst_percent / 100), 2);
  new.total_amount := v_total;
  new.taxable_value := v_taxable;
  new.gst_amount := v_total - v_taxable;
  return new;
end;
$$;
create trigger trg_supplier_bill_items_calc before insert or update of quantity, rate_inclusive, gst_percent
  on public.supplier_bill_items for each row execute function public.supplier_bill_items_calc();

create or replace function public.recalc_supplier_bill_totals(p_bill_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
begin
  select coalesce(sum(taxable_value), 0), coalesce(sum(gst_amount), 0)
    into v_subtotal, v_tax
  from public.supplier_bill_items where bill_id = p_bill_id;

  update public.supplier_bills
    set subtotal = v_subtotal, tax_amount = v_tax, grand_total = v_subtotal + v_tax
    where id = p_bill_id;
end;
$$;

create or replace function public.supplier_bill_items_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_supplier_bill_totals(coalesce(new.bill_id, old.bill_id));
  return null;
end;
$$;
create trigger trg_supplier_bill_items_changed
  after insert or update or delete on public.supplier_bill_items
  for each row execute function public.supplier_bill_items_changed();

-- Approve once: posts the expense (implicitly, by moving to 'approved' -- reporting reads
-- status = 'approved' as the posted set) and, for any line already matched to a tracked
-- inventory item, records the purchase into stock at the bill's project (or company pool when
-- design_project_id is null) -- "anything entered into project inventory is billed into it".
create or replace function public.approve_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_item record;
  v_location_id uuid;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to approve supplier bills.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'pending_review' then
    raise exception 'Only a bill pending review can be approved.';
  end if;
  if v_bill.supplier_id is null then
    raise exception 'Match this bill to a supplier before approving it.';
  end if;

  if v_bill.design_project_id is not null then
    select id into v_location_id from public.inventory_locations
      where kind = 'project' and design_project_id = v_bill.design_project_id;
  else
    select id into v_location_id from public.inventory_locations where kind = 'company';
  end if;

  for v_item in
    select * from public.supplier_bill_items
    where bill_id = p_bill_id and item_type = 'material' and inventory_item_id is not null
  loop
    if (select track_as_inventory from public.inventory_items where id = v_item.inventory_item_id) then
      perform public.record_inventory_purchase(
        v_item.inventory_item_id, v_location_id, v_item.quantity,
        v_item.total_amount / v_item.quantity, v_bill.bill_date,
        'supplier_bill', p_bill_id, 'Supplier bill ' || v_bill.internal_bill_number);
    end if;
  end loop;

  update public.supplier_bills
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_bill_id;
end;
$$;

grant execute on function public.approve_supplier_bill(uuid) to authenticated;
