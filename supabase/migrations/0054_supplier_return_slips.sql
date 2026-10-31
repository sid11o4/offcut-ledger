-- Return slips: stock sent back to a supplier. A slip is made first, with its numbered lines and the value
-- returned, and only then does the stock leave the location. Each line takes stock out at the location's
-- average cost, exactly as any other outflow, so the value returned is what the books hold for it. The slip
-- total is the amount owed back by the supplier.

create sequence if not exists public.supplier_return_slip_seq;

create table if not exists public.supplier_return_slips (
  id uuid primary key default gen_random_uuid(),
  slip_number text not null unique,
  return_date date not null default current_date,
  supplier_id uuid not null references public.suppliers(id),
  location_id uuid not null references public.inventory_locations(id),
  reason text,
  total_amount numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_return_slip_items (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.supplier_return_slips(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0,
  total_amount numeric(14,2) not null default 0,
  reason text
);

create index if not exists idx_return_slip_items_slip on public.supplier_return_slip_items(slip_id);
create index if not exists idx_return_slips_supplier on public.supplier_return_slips(supplier_id);

alter table public.supplier_return_slips enable row level security;
alter table public.supplier_return_slip_items enable row level security;

create policy return_slips_select on public.supplier_return_slips for select
  using (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));
create policy return_slip_items_select on public.supplier_return_slip_items for select
  using (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));

create trigger trg_audit_return_slips
  after insert or update or delete on public.supplier_return_slips
  for each row execute function public.audit_row_change();
create trigger trg_audit_return_slip_items
  after insert or update or delete on public.supplier_return_slip_items
  for each row execute function public.audit_row_change();

-- Creates the slip and takes each line's stock out. Runs as the caller, so the permission and the
-- stock-goes-negative rule both apply. Returns the slip id.
create or replace function public.create_supplier_return(
  p_supplier_id uuid, p_location_id uuid, p_return_date date, p_reason text, p_items jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_slip_id uuid;
  v_number text;
  v_line jsonb;
  v_txn_id uuid;
  v_unit numeric;
  v_total numeric;
  v_sum numeric := 0;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to return stock to a supplier.';
  end if;
  if p_supplier_id is null then raise exception 'Choose the supplier the stock is returned to.'; end if;
  if p_location_id is null then raise exception 'Choose where the stock is returned from.'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item to the return slip.';
  end if;

  v_number := 'RTN-' || lpad(nextval('public.supplier_return_slip_seq')::text, 4, '0');
  insert into public.supplier_return_slips (slip_number, return_date, supplier_id, location_id, reason)
    values (v_number, coalesce(p_return_date, current_date), p_supplier_id, p_location_id, nullif(btrim(p_reason), ''))
    returning id into v_slip_id;

  for v_line in select * from jsonb_array_elements(p_items) loop
    if (v_line->>'quantity')::numeric <= 0 then raise exception 'Each returned quantity must be above zero.'; end if;

    v_txn_id := public.record_inventory_transaction(
      'adjustment', (v_line->>'item_id')::uuid, p_location_id, -((v_line->>'quantity')::numeric), null,
      coalesce(p_return_date, current_date), 'manual_slip', v_slip_id,
      'Returned to supplier on ' || v_number);

    select abs(unit_cost), abs(total_cost) into v_unit, v_total
      from public.inventory_transactions where id = v_txn_id;

    insert into public.supplier_return_slip_items (slip_id, item_id, quantity, unit_cost, total_amount, reason)
      values (v_slip_id, (v_line->>'item_id')::uuid, (v_line->>'quantity')::numeric, coalesce(v_unit, 0),
              coalesce(v_total, 0), nullif(btrim(v_line->>'reason'), ''));
    v_sum := v_sum + coalesce(v_total, 0);
  end loop;

  update public.supplier_return_slips set total_amount = v_sum where id = v_slip_id;
  return v_slip_id;
end;
$$;

revoke execute on function public.create_supplier_return(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_supplier_return(uuid, uuid, date, text, jsonb) to authenticated;
