-- Through a FORMGRID bill, only the payment reaches the vendor's account. A line can be marked as paying
-- credit the vendor already holds: it carries no cost head, is not a cost and is not a payable of the bill,
-- and never touches inventory. Cost heads act only on the other lines (non-inventory, with no vendor link).
-- On approval, the cash and RTGS / NEFT payments worth those lines are applied to the vendor's outstanding bills.
alter table public.supplier_bill_items add column if not exists pays_vendor_credit boolean not null default false;

create or replace function public.supplier_bill_items_vendor_credit_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pays_vendor_credit then
    if not exists (select 1 from public.supplier_bills b where b.id = new.bill_id and b.bill_source = 'formgrid') then
      new.pays_vendor_credit := false;
    else
      new.cost_head := null;
      new.inventory_item_id := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_supplier_bill_items_vendor_credit on public.supplier_bill_items;
create trigger trg_supplier_bill_items_vendor_credit before insert or update on public.supplier_bill_items
  for each row execute function public.supplier_bill_items_vendor_credit_rules();

-- The bill's own totals leave out lines that pay vendor credit.
create or replace function public.recalc_supplier_bill_totals(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
begin
  select coalesce(sum(taxable_value), 0), coalesce(sum(gst_amount), 0)
    into v_subtotal, v_tax
  from public.supplier_bill_items where bill_id = p_bill_id and not pays_vendor_credit;

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
drop trigger if exists trg_supplier_bill_items_changed on public.supplier_bill_items;
create trigger trg_supplier_bill_items_changed
  after insert or update or delete on public.supplier_bill_items
  for each row execute function public.supplier_bill_items_changed();

-- Cost reports leave those lines out too.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.design_build_cost_breakdown(uuid, date, date)'::regprocedure);
  execute replace(d, 'i.inventory_item_id is null', 'i.inventory_item_id is null and not i.pays_vendor_credit');
  d := pg_get_functiondef('public.report_design_project_financials(uuid)'::regprocedure);
  execute replace(d, 'i.inventory_item_id is null', 'i.inventory_item_id is null and not i.pays_vendor_credit');
end $$;

-- Applies p_credit of a FORMGRID bill's cash and RTGS / NEFT payments to the vendor's outstanding bills, oldest first.
drop function if exists public.apply_formgrid_payments_to_vendor_credit(uuid);
create or replace function public.apply_formgrid_payments_to_vendor_credit(p_bill_id uuid, p_credit numeric)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
  v_pay public.supplier_bill_payments;
  v_v record;
  v_rem numeric := p_credit;
  v_left numeric;
  v_take numeric;
  v_open numeric;
begin
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.supplier_id is null then raise exception 'Match this bill to the vendor whose credit it pays.'; end if;

  for v_pay in select * from public.supplier_bill_payments where bill_id = p_bill_id and mode in ('cash', 'rtgs_neft') order by created_at, id loop
    exit when v_rem <= 0.004;
    v_left := least(v_pay.allocated_amount, v_rem);
    v_rem := v_rem - v_left;
    for v_v in
      select b.id, b.grand_total from public.supplier_bills b
      where b.supplier_id = v_bill.supplier_id and b.bill_source = 'vendor' and b.status = 'approved'
      order by b.bill_date, b.created_at
    loop
      exit when v_left <= 0.004;
      select v_v.grand_total
        - coalesce((select sum(p.allocated_amount) from public.supplier_bill_payments p where p.bill_id = v_v.id and p.mode in ('cash', 'rtgs_neft', 'waiver')), 0)
        - coalesce((select sum(coalesce(r.credit_amount, r.total_amount)) from public.supplier_return_slips r where r.adjusted_bill_id = v_v.id and r.credit_status = 'settled'), 0)
        into v_open;
      continue when v_open <= 0.004;
      v_take := least(v_left, v_open);
      if v_take >= v_pay.allocated_amount - 0.004 then
        update public.supplier_bill_payments set bill_id = v_v.id, remarks = coalesce(v_pay.remarks || ' · ', '') || 'Paid through FORMGRID bill ' || v_bill.internal_bill_number where id = v_pay.id;
      else
        if v_pay.confirmed then raise exception 'A payment already matched to the bank cannot be split. Record it as a separate payment.'; end if;
        insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, remarks, utr_reference, created_by)
          values (v_v.id, v_pay.mode, v_take, 'Paid through FORMGRID bill ' || v_bill.internal_bill_number, v_pay.utr_reference, v_pay.created_by);
        update public.supplier_bill_payments set allocated_amount = allocated_amount - v_take where id = v_pay.id;
        v_pay.allocated_amount := v_pay.allocated_amount - v_take;
      end if;
      v_left := v_left - v_take;
    end loop;
    if v_left > 0.5 then
      raise exception 'This vendor''s outstanding bills are Rs % less than the credit this bill pays.', round(v_left, 2);
    end if;
  end loop;
  if v_rem > 0.5 then
    raise exception 'Pay at least Rs % more in cash or RTGS / NEFT: the lines that pay vendor credit must be paid.', round(v_rem, 2);
  end if;
  delete from public.supplier_bill_payments where bill_id = p_bill_id and allocated_amount <= 0.004;
end;
$function$;
revoke all on function public.apply_formgrid_payments_to_vendor_credit(uuid, numeric) from public, anon, authenticated;

create or replace function public.approve_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill record;
  v_item record;
  v_location_id uuid;
  v_credit numeric;
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

  if v_bill.bill_source = 'vendor' then
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

    perform public.post_unlinked_bill_lines(p_bill_id);
  end if;

  if v_bill.bill_source = 'formgrid' then
    -- Only the payment reaches the vendor's account: the lines that pay vendor credit.
    select coalesce(sum(total_amount), 0) into v_credit from public.supplier_bill_items where bill_id = p_bill_id and pays_vendor_credit;
    if v_credit > 0 then
      perform public.apply_formgrid_payments_to_vendor_credit(p_bill_id, v_credit);
    end if;
    -- A bill made only of vendor-credit lines has nothing left of its own.
    if v_credit > 0 and v_bill.grand_total <= 0.5 then
      update public.supplier_bills set status = 'applied', approved_by = auth.uid(), approved_at = now() where id = p_bill_id;
      return;
    end if;
  end if;

  update public.supplier_bills
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_bill_id;

  if v_bill.bill_source = 'formgrid' then
    perform public.ensure_gst_followup(p_bill_id);
  end if;
end;
$function$;
revoke all on function public.approve_supplier_bill(uuid) from public, anon;
grant execute on function public.approve_supplier_bill(uuid) to authenticated;
