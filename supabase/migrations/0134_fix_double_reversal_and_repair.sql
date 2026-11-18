-- Reopening or voiding a bill reversed every stock purchase it ever had, including ones an earlier reopen had already
-- reversed, so editing a bill more than once took its stock out two or three times (the "Short" items).
-- 1. Reopen and void now reverse only what is still outstanding (purchases less earlier reversals).
-- 2. over_reversed_bill_stock() lists what was over-reversed, and repair_over_reversed_bill_stock() puts it back.
do $$
declare d text; e text;
begin
  e := 'sum(case when txn_type = ''purchase'' then quantity when txn_type = ''adjustment'' and quantity < 0 and notes like ''Reversed:%'' then quantity when txn_type = ''adjustment'' and quantity > 0 and notes like ''Correction:%'' then quantity else 0 end)';

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'void_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('select item_id, location_id, quantity, unit_cost' in d) = 0 or position('and reference_id = p_bill_id and txn_type = ''purchase''' in d) = 0 then raise exception 'void markers missing'; end if;
  d := replace(d, 'select item_id, location_id, quantity, unit_cost', 'select item_id, location_id, ' || e || ' as quantity, 0::numeric as unit_cost');
  d := replace(d, 'and reference_id = p_bill_id and txn_type = ''purchase''', 'and reference_id = p_bill_id group by item_id, location_id having ' || e || ' > 0.0001');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'reopen_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('select item_id, location_id, quantity from public.inventory_transactions' in d) = 0 or position('and reference_id = p_bill_id and txn_type = ''purchase''' in d) = 0 then raise exception 'reopen markers missing'; end if;
  d := replace(d, 'select item_id, location_id, quantity from public.inventory_transactions', 'select item_id, location_id, ' || e || ' as quantity from public.inventory_transactions');
  d := replace(d, 'and reference_id = p_bill_id and txn_type = ''purchase''', 'and reference_id = p_bill_id group by item_id, location_id having ' || e || ' > 0.0001');
  execute d;
end $$;

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
    from public.inventory_transactions t where t.reference_type = 'supplier_bill' group by t.reference_id, t.item_id, t.location_id
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
      from public.inventory_transactions t where t.reference_type = 'supplier_bill' group by t.reference_id, t.item_id, t.location_id
    ) g where g.net < -0.0001
  loop
    perform public.record_inventory_transaction('adjustment', r.item_id, r.location_id, r.qty, r.avg_cost, current_date,
      'supplier_bill', r.reference_id, 'Correction: stock reversed more than once when a bill was edited');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.repair_over_reversed_bill_stock() from public, anon;
grant execute on function public.repair_over_reversed_bill_stock() to authenticated;
