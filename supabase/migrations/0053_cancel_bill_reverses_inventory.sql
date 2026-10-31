-- Cancelling a bill now reverses the stock its Internal Order lines used. When a billed job-work entry is
-- billed, its raw material and laminate are consumed from the project's stock (see 0029), tagged to the
-- bill line. Cancelling the bill puts that stock back, once, as an adjustment against the same bill line.

create or replace function public.cancel_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updated int;
  r record;
begin
  if not public.has_permission('bill_cancel') then
    raise exception 'You do not have permission to cancel bills.';
  end if;

  update public.bills
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_bill_id and status <> 'cancelled';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return; -- already cancelled, so the stock was already put back
  end if;

  for r in
    select t.item_id, t.location_id, -t.quantity as qty, t.unit_cost, t.reference_id as bill_item_id
    from public.inventory_transactions t
    join public.bill_items bi on bi.id = t.reference_id
    where bi.bill_id = p_bill_id
      and t.reference_type = 'internal_order'
      and t.txn_type = 'consumption'
      and not exists (
        select 1 from public.inventory_transactions rv
        where rv.reference_type = 'internal_order' and rv.txn_type = 'adjustment'
          and rv.reference_id = t.reference_id and rv.item_id = t.item_id and rv.location_id = t.location_id
      )
  loop
    perform public.record_inventory_transaction(
      'adjustment', r.item_id, r.location_id, r.qty, r.unit_cost, current_date,
      'internal_order', r.bill_item_id,
      'Reversed: bill cancelled' || coalesce(' - ' || p_reason, '')
    );
  end loop;
end;
$$;
