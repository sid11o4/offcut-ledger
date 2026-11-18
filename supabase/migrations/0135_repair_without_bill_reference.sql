-- The repair posted its correcting entries with the old bill's id as a supplier_bill reference. The old bill had been deleted, so the
-- stock lot it creates could not point at it (inventory_lots_vendor_bill_id_fkey). The correction is now an ordinary adjustment that
-- only carries the old bill's id for matching, and detection counts those corrections.
create or replace function public.over_reversed_bill_stock()
returns table(item_id uuid, item_name text, location_id uuid, location_name text, quantity numeric, unit_cost numeric)
language sql stable security definer set search_path = public as $$
  select g.item_id, i.name, g.location_id, l.name, -g.net, g.avg_cost
  from (
    select t.reference_id, t.item_id, t.location_id,
      sum(case when t.txn_type = 'purchase' then t.quantity
               when t.txn_type = 'adjustment' and t.quantity < 0 and t.notes like 'Reversed:%' then t.quantity
               when t.txn_type = 'adjustment' and t.quantity > 0 and t.notes like 'Correction:%' then t.quantity else 0 end) as net,
      coalesce(avg(t.unit_cost) filter (where t.txn_type = 'purchase'), 0) as avg_cost
    from public.inventory_transactions t
    where t.reference_type = 'supplier_bill' or (t.reference_type = 'adjustment' and t.notes like 'Correction:%')
    group by t.reference_id, t.item_id, t.location_id
  ) g
  join public.inventory_items i on i.id = g.item_id
  join public.inventory_locations l on l.id = g.location_id
  where g.net < -0.0001;
$$;
grant execute on function public.over_reversed_bill_stock() to authenticated;

create or replace function public.repair_over_reversed_bill_stock()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  if not public.has_permission('inventory_operate') then raise exception 'You do not have permission to repair stock.'; end if;
  for r in
    select g.reference_id, g.item_id, g.location_id, -g.net as qty, g.avg_cost
    from (
      select t.reference_id, t.item_id, t.location_id,
        sum(case when t.txn_type = 'purchase' then t.quantity
                 when t.txn_type = 'adjustment' and t.quantity < 0 and t.notes like 'Reversed:%' then t.quantity
                 when t.txn_type = 'adjustment' and t.quantity > 0 and t.notes like 'Correction:%' then t.quantity else 0 end) as net,
        coalesce(avg(t.unit_cost) filter (where t.txn_type = 'purchase'), 0) as avg_cost
      from public.inventory_transactions t
      where t.reference_type = 'supplier_bill' or (t.reference_type = 'adjustment' and t.notes like 'Correction:%')
      group by t.reference_id, t.item_id, t.location_id
    ) g where g.net < -0.0001
  loop
    perform public.record_inventory_transaction('adjustment', r.item_id, r.location_id, r.qty, r.avg_cost, current_date,
      'adjustment', r.reference_id, 'Correction: stock reversed more than once when a bill was edited');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.repair_over_reversed_bill_stock() from public, anon;
grant execute on function public.repair_over_reversed_bill_stock() to authenticated;
