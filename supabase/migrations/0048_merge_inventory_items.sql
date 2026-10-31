-- Merge a placeholder inventory item into the real one it stands for. A material created from a job
-- (ensure_inventory_item) starts as its own item with negative stock. Once the real item is known,
-- this moves everything that refers to the placeholder onto the real item, and retires the
-- placeholder. Stock balances are added together per location; the cost of the result is the
-- weighted cost of the positive stock on both sides, so a negative balance adds no cost.
create or replace function public.merge_inventory_item(p_from_item uuid, p_into_item uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_unit uuid;
  v_into_unit uuid;
  s record;
  t record;
  v_qty numeric;
  v_avg numeric;
  v_txns integer;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to merge inventory items.';
  end if;
  if p_from_item = p_into_item then raise exception 'Choose a different item to merge into.'; end if;

  select unit_id into v_from_unit from public.inventory_items where id = p_from_item and active for update;
  select unit_id into v_into_unit from public.inventory_items where id = p_into_item and active for update;
  if v_from_unit is null or v_into_unit is null then raise exception 'Both items must be active inventory items.'; end if;
  if v_from_unit <> v_into_unit then
    raise exception 'The two items are measured in different units, so they cannot be merged.';
  end if;

  -- Stock per location: add the balances together where both items have stock there.
  for s in select * from public.inventory_stock where item_id = p_from_item loop
    select * into t from public.inventory_stock
      where item_id = p_into_item and location_id = s.location_id for update;
    if found then
      v_qty := t.quantity + s.quantity;
      v_avg := case when greatest(t.quantity, 0) + greatest(s.quantity, 0) > 0 then
        (greatest(t.quantity, 0) * t.avg_unit_cost + greatest(s.quantity, 0) * s.avg_unit_cost)
          / (greatest(t.quantity, 0) + greatest(s.quantity, 0))
        else 0 end;
      update public.inventory_stock
        set quantity = v_qty, avg_unit_cost = v_avg, updated_at = now()
        where item_id = p_into_item and location_id = s.location_id;
      delete from public.inventory_stock where item_id = p_from_item and location_id = s.location_id;
    else
      update public.inventory_stock set item_id = p_into_item
        where item_id = p_from_item and location_id = s.location_id;
    end if;
  end loop;

  -- Everything else that refers to the placeholder.
  update public.inventory_transactions set item_id = p_into_item where item_id = p_from_item;
  get diagnostics v_txns = row_count;
  update public.inventory_slip_items set item_id = p_into_item where item_id = p_from_item;
  update public.supplier_bill_items set inventory_item_id = p_into_item where inventory_item_id = p_from_item;
  update public.material_match_suggestions set suggested_inventory_item_id = p_into_item
    where suggested_inventory_item_id = p_from_item;
  update public.job_work_entries set raw_material_item_id = p_into_item where raw_material_item_id = p_from_item;
  update public.job_work_entries set skin1_item_id = p_into_item where skin1_item_id = p_from_item;
  update public.job_work_entries set skin2_item_id = p_into_item where skin2_item_id = p_from_item;

  update public.inventory_items set active = false, updated_by = auth.uid(), updated_at = now()
    where id = p_from_item;
  return v_txns;
end;
$$;

revoke execute on function public.merge_inventory_item(uuid, uuid) from public, anon;
grant execute on function public.merge_inventory_item(uuid, uuid) to authenticated;
