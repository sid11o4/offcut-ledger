-- A voided supplier bill can be reopened to correct it. Approving it again posts its stock again.
create or replace function public.reopen_supplier_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to reopen supplier bills.';
  end if;
  if v_reason is null then raise exception 'Give a reason for reopening the bill.'; end if;
  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'void' then raise exception 'Only a voided bill can be reopened.'; end if;
  update public.supplier_bills
    set status = 'pending_review', voided_by = null, voided_at = null, void_reason = null,
        remarks = array_to_string(array_remove(array[remarks, '[Reopened] ' || v_reason], null), ' · ')
    where id = p_bill_id;
end;
$$;

revoke all on function public.reopen_supplier_bill(uuid, text) from public, anon;
grant execute on function public.reopen_supplier_bill(uuid, text) to authenticated;

-- A direct purchase with no vendor is corrected: the mistaken entry is reversed, and the right one posted.
create or replace function public.correct_direct_purchase(p_txn_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.inventory_transactions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new uuid;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to correct stock entries.';
  end if;
  if v_reason is null then raise exception 'Give a reason for the correction.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
  select * into v_t from public.inventory_transactions where id = p_txn_id for update;
  if v_t.id is null then raise exception 'Entry not found.'; end if;
  if v_t.txn_type <> 'purchase' or v_t.reference_type <> 'adjustment' then
    raise exception 'Only a direct purchase with no vendor can be corrected here.';
  end if;
  if v_t.reversed_by is not null then raise exception 'This entry has already been reversed.'; end if;

  perform public.record_inventory_transaction('adjustment', v_t.item_id, v_t.location_id, -v_t.quantity,
    v_t.unit_cost, v_t.txn_date, 'adjustment', v_t.id, 'Reversal: ' || v_reason);
  update public.inventory_transactions set reversed_by = (
    select id from public.inventory_transactions where reference_id = v_t.id and txn_type = 'adjustment' order by created_at desc limit 1
  ) where id = v_t.id;

  v_new := public.record_inventory_transaction('purchase', v_t.item_id, v_t.location_id, p_quantity,
    coalesce(p_unit_cost, 0), coalesce(p_date, v_t.txn_date), 'adjustment', null, 'Corrected: ' || v_reason);
  return v_new;
end;
$$;

revoke all on function public.correct_direct_purchase(uuid, numeric, numeric, date, text) from public, anon;
grant execute on function public.correct_direct_purchase(uuid, numeric, numeric, date, text) to authenticated;
