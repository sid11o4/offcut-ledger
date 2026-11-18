-- Merge one inventory item into another: everything that refers to it moves onto the other item, and the merged item is
-- retired. Its name is kept as an alias, so a bill or job that uses the old name later lands on the kept item instead of
-- creating the duplicate again.
create table if not exists public.inventory_item_aliases (
  alias_key text primary key,
  item_id uuid not null references public.inventory_items(id),
  alias_name text not null,
  created_at timestamptz not null default now()
);
alter table public.inventory_item_aliases enable row level security;
drop policy if exists inventory_item_aliases_read on public.inventory_item_aliases;
create policy inventory_item_aliases_read on public.inventory_item_aliases for select to authenticated using (true);

create or replace function public.merge_inventory_item(p_from_item uuid, p_into_item uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from record;
  v_into record;
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

  select * into v_from from public.inventory_items where id = p_from_item and active for update;
  select * into v_into from public.inventory_items where id = p_into_item and active for update;
  if v_from.id is null or v_into.id is null then raise exception 'Both items must be active inventory items.'; end if;
  if v_from.unit_id <> v_into.unit_id then
    raise exception 'The two items are measured in different units, so they cannot be merged.';
  end if;
  if coalesce(v_from.is_composite, false) or coalesce(v_into.is_composite, false) then
    raise exception 'A composite material cannot be merged.';
  end if;

  for s in select * from public.inventory_stock where item_id = p_from_item loop
    select * into t from public.inventory_stock where item_id = p_into_item and location_id = s.location_id for update;
    if found then
      v_qty := t.quantity + s.quantity;
      v_avg := case when greatest(t.quantity, 0) + greatest(s.quantity, 0) > 0 then
        (greatest(t.quantity, 0) * t.avg_unit_cost + greatest(s.quantity, 0) * s.avg_unit_cost)
          / (greatest(t.quantity, 0) + greatest(s.quantity, 0))
        else 0 end;
      update public.inventory_stock set quantity = v_qty, avg_unit_cost = v_avg, updated_at = now()
        where item_id = p_into_item and location_id = s.location_id;
      delete from public.inventory_stock where item_id = p_from_item and location_id = s.location_id;
    else
      update public.inventory_stock set item_id = p_into_item where item_id = p_from_item and location_id = s.location_id;
    end if;
  end loop;

  update public.inventory_transactions set item_id = p_into_item where item_id = p_from_item;
  get diagnostics v_txns = row_count;
  update public.inventory_lots set item_id = p_into_item where item_id = p_from_item;
  update public.inventory_slip_items set item_id = p_into_item where item_id = p_from_item;
  update public.past_material_consumption set item_id = p_into_item where item_id = p_from_item;
  update public.supplier_return_slip_items set item_id = p_into_item where item_id = p_from_item;
  update public.supplier_bill_items set inventory_item_id = p_into_item where inventory_item_id = p_from_item;
  update public.material_match_suggestions set suggested_inventory_item_id = p_into_item where suggested_inventory_item_id = p_from_item;
  update public.inventory_composite_parts set component_item_id = p_into_item where component_item_id = p_from_item;
  update public.job_work_entries set raw_material_item_id = p_into_item where raw_material_item_id = p_from_item;
  update public.job_work_entries set skin1_item_id = p_into_item where skin1_item_id = p_from_item;
  update public.job_work_entries set skin2_item_id = p_into_item where skin2_item_id = p_from_item;

  update public.inventory_item_aliases set item_id = p_into_item where item_id = p_from_item;
  insert into public.inventory_item_aliases (alias_key, item_id, alias_name)
    values (public.inventory_name_key(v_from.name), p_into_item, v_from.name)
    on conflict (alias_key) do update set item_id = excluded.item_id;

  update public.inventory_items set active = false, updated_by = auth.uid(), updated_at = now() where id = p_from_item;
  return v_txns;
end;
$$;
revoke execute on function public.merge_inventory_item(uuid, uuid) from public, anon;
grant execute on function public.merge_inventory_item(uuid, uuid) to authenticated;

-- A name that was merged away resolves to the item it was merged into.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'ensure_inventory_item' and pronamespace = 'public'::regnamespace;
  if position('select id into v_unit from public.units where code = p_unit_code and active;' in d) = 0 then raise exception 'ensure marker missing'; end if;
  d := replace(d, 'select id into v_unit from public.units where code = p_unit_code and active;',
    E'select a.item_id into v_id from public.inventory_item_aliases a join public.inventory_items i on i.id = a.item_id and i.active where a.alias_key = v_key;\n  if v_id is not null then return v_id; end if;\n\n  select id into v_unit from public.units where code = p_unit_code and active;');
  execute d;
end $$;
