-- Making a composite uses up its materials: one raw board, one skin 1 and (if any) one skin 2 per
-- composite unit leave company stock at their average cost, and the composite comes in at their
-- combined cost plus the job works completed on it. Not enough of any material stops the whole thing.
create or replace function public.make_composite(p_item_id uuid, p_quantity numeric, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid;
  v_part record;
  v_unit_cost numeric := 0;
  v_stock record;
  v_name text;
  v_txn uuid;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to make composite materials.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter how many to make.'; end if;
  select name into v_name from public.inventory_items where id = p_item_id and is_composite;
  if v_name is null then raise exception 'That is not a composite material.'; end if;
  select id into v_loc from public.inventory_locations where kind = 'company' limit 1;

  -- Check everything is in stock first, so nothing is half-consumed.
  for v_part in select * from public.inventory_composite_parts
    where item_id = p_item_id and role in ('raw', 'skin1', 'skin2') order by sort_order loop
    select quantity, avg_unit_cost into v_stock from public.inventory_stock
      where location_id = v_loc and item_id = v_part.component_item_id;
    if not found or v_stock.quantity < p_quantity then
      raise exception 'Not enough % in company stock: % available, % needed.',
        (select name from public.inventory_items where id = v_part.component_item_id),
        coalesce(v_stock.quantity, 0), p_quantity;
    end if;
  end loop;

  for v_part in select * from public.inventory_composite_parts
    where item_id = p_item_id and role in ('raw', 'skin1', 'skin2') order by sort_order loop
    select avg_unit_cost into v_stock from public.inventory_stock
      where location_id = v_loc and item_id = v_part.component_item_id;
    v_unit_cost := v_unit_cost + coalesce(v_stock.avg_unit_cost, 0);
    perform public.record_inventory_transaction('consumption', v_part.component_item_id, v_loc, -p_quantity, 0,
      p_date, 'adjustment', p_item_id, 'Used to make ' || v_name);
  end loop;

  select v_unit_cost + coalesce(sum(unit_cost), 0) into v_unit_cost
    from public.inventory_composite_parts where item_id = p_item_id and role = 'jobwork';

  v_txn := public.record_inventory_transaction('purchase', p_item_id, v_loc, p_quantity, v_unit_cost,
    p_date, 'adjustment', p_item_id, 'Made from its materials');
  return v_txn;
end;
$$;

revoke all on function public.make_composite(uuid, numeric, date) from public, anon;
grant execute on function public.make_composite(uuid, numeric, date) to authenticated;
