-- FORMGRID bills are never inventory. A FORMGRID bill is either a direct expense, or the payment of credit
-- that a vendor already holds on their own (vendor) bills. The purpose is chosen on the bill:
--   direct_expense : counted as a cost and as a payable until paid, as before, but never as stock.
--   vendor_credit  : on approval its cash and RTGS/NEFT payments are applied to that vendor's outstanding
--                    bills, oldest first. The FORMGRID bill itself becomes 'applied' and counts for nothing,
--                    so the cost and the payable are not counted twice.
alter table public.supplier_bills
  add column if not exists purpose text not null default 'direct_expense'
    check (purpose in ('direct_expense', 'vendor_credit'));

alter table public.supplier_bills drop constraint if exists supplier_bills_status_check;
alter table public.supplier_bills add constraint supplier_bills_status_check
  check (status in ('pending_review', 'approved', 'applied', 'void'));

-- A line of a FORMGRID bill is never linked to stock, however it got there (a scan match, a confirmation).
create or replace function public.supplier_bill_items_no_stock_for_formgrid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.inventory_item_id is not null
     and exists (select 1 from public.supplier_bills b where b.id = new.bill_id and b.bill_source = 'formgrid') then
    new.inventory_item_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_supplier_bill_items_no_stock on public.supplier_bill_items;
create trigger trg_supplier_bill_items_no_stock before insert or update of inventory_item_id on public.supplier_bill_items
  for each row execute function public.supplier_bill_items_no_stock_for_formgrid();

update public.supplier_bill_items i set inventory_item_id = null
  from public.supplier_bills b where b.id = i.bill_id and b.bill_source = 'formgrid' and i.inventory_item_id is not null;
delete from public.material_match_suggestions s using public.supplier_bill_items i, public.supplier_bills b
  where s.supplier_bill_item_id = i.id and b.id = i.bill_id and b.bill_source = 'formgrid';

-- Applies a FORMGRID bill's payments to the vendor's outstanding bills, oldest first.
create or replace function public.apply_formgrid_payments_to_vendor_credit(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
  v_pay public.supplier_bill_payments;
  v_v record;
  v_left numeric;
  v_take numeric;
  v_open numeric;
begin
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.supplier_id is null then raise exception 'Match this bill to the vendor whose credit it pays.'; end if;
  if exists (select 1 from public.supplier_bill_payments where bill_id = p_bill_id and mode in ('credit', 'waiver')) then
    raise exception 'A bill that pays vendor credit can only be paid in cash or by RTGS / NEFT.';
  end if;

  for v_pay in select * from public.supplier_bill_payments where bill_id = p_bill_id and mode in ('cash', 'rtgs_neft') order by created_at, id loop
    v_left := v_pay.allocated_amount;
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
        -- the whole payment fits on this bill: move it, keeping its bank match
        update public.supplier_bill_payments set bill_id = v_v.id, remarks = coalesce(v_pay.remarks || ' · ', '') || 'Paid through FORMGRID bill ' || v_bill.internal_bill_number where id = v_pay.id;
      else
        if v_pay.confirmed then raise exception 'A payment already matched to the bank cannot be split across vendor bills. Record it against one bill.'; end if;
        insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, remarks, utr_reference, created_by)
          values (v_v.id, v_pay.mode, v_take, 'Paid through FORMGRID bill ' || v_bill.internal_bill_number, v_pay.utr_reference, v_pay.created_by);
        update public.supplier_bill_payments set allocated_amount = allocated_amount - v_take where id = v_pay.id;
        v_pay.allocated_amount := v_pay.allocated_amount - v_take;
      end if;
      v_left := v_left - v_take;
    end loop;
    if v_left > 0.5 then
      raise exception 'This vendor''s outstanding bills are Rs % less than the payment. Reduce the payment or choose direct expense.', round(v_left, 2);
    end if;
  end loop;
  delete from public.supplier_bill_payments where bill_id = p_bill_id and allocated_amount <= 0.004;
end;
$function$;
revoke all on function public.apply_formgrid_payments_to_vendor_credit(uuid) from public, anon, authenticated;

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

    -- Material lines that were never linked still become stock.
    perform public.post_unlinked_bill_lines(p_bill_id);
  end if;

  if v_bill.bill_source = 'formgrid' and v_bill.purpose = 'vendor_credit' then
    -- Pays vendor credit that already exists: the payments go onto the vendor's bills.
    perform public.apply_formgrid_payments_to_vendor_credit(p_bill_id);
    update public.supplier_bills set status = 'applied', approved_by = auth.uid(), approved_at = now() where id = p_bill_id;
    return;
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
