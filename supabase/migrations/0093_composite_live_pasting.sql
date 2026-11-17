-- A composite's pasting cost follows the job work catalogue: one skin is one side of pasting, two
-- skins is both sides (twice the rate). It is read from the active "Pasting" rate for Design Build
-- Order every time, never stored, so a rate change reaches every composite without re-saving.

create or replace function public.composite_pasting_rate()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((
    select r.rate
    from public.rates r
    join public.job_work_services s on s.id = r.job_work_service_id
    join public.rate_categories rc on rc.id = r.rate_category_id
    where s.name = 'Pasting' and rc.name = 'Design Build Order'
      and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
    order by r.effective_from desc
    limit 1
  ), 0);
$$;
grant execute on function public.composite_pasting_rate() to authenticated;

-- Pasting lines stored by the first version are dropped; the rate is applied live now.
delete from public.inventory_composite_parts where role = 'jobwork' and label in ('Pasting (single side)', 'Pasting (both sides)');

create or replace view public.inventory_composite_values with (security_invoker = true) as
select i.id as item_id,
  coalesce((select sum(p.unit_cost) from public.inventory_composite_parts p where p.item_id = i.id), 0)
  + (select count(*) from public.inventory_composite_parts p where p.item_id = i.id and p.role in ('skin1', 'skin2'))
    * public.composite_pasting_rate() as unit_value
from public.inventory_items i
where i.is_composite;
grant select on public.inventory_composite_values to authenticated;

-- Saving ignores any pasting line (it is never stored) and keeps default_rate as the current value.
create or replace function public.save_composite_item(p_item_id uuid, p_name text, p_parts jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_item_id;
  v_part jsonb;
  v_raw uuid;
  v_unit uuid;
  v_total numeric := 0;
  v_i int := 0;
  v_skin1 int := 0;
  v_skin2 int := 0;
  v_rawn int := 0;
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('master_data')) then
    raise exception 'You do not have permission to set up composite materials.';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter a name for the composite material.'; end if;
  if jsonb_typeof(p_parts) <> 'array' then raise exception 'Parts are required.'; end if;

  for v_part in select * from jsonb_array_elements(p_parts) loop
    if v_part->>'role' = 'jobwork' and (v_part->>'label') in ('Pasting (single side)', 'Pasting (both sides)') then continue; end if;
    if v_part->>'role' = 'raw' then v_rawn := v_rawn + 1; v_raw := (v_part->>'component_item_id')::uuid; end if;
    if v_part->>'role' = 'skin1' then v_skin1 := v_skin1 + 1; end if;
    if v_part->>'role' = 'skin2' then v_skin2 := v_skin2 + 1; end if;
    if v_part->>'role' in ('raw', 'skin1', 'skin2') and (v_part->>'component_item_id') is null then
      raise exception 'Pick the material for every board and skin.';
    end if;
    if v_part->>'role' = 'jobwork' and coalesce(btrim(v_part->>'label'), '') = '' then
      raise exception 'Name each completed job work.';
    end if;
    v_total := v_total + coalesce((v_part->>'unit_cost')::numeric, 0);
  end loop;
  if v_rawn <> 1 then raise exception 'A composite material needs exactly one raw board.'; end if;
  if v_skin1 <> 1 then raise exception 'A composite material needs a skin 1.'; end if;
  if v_skin2 > 1 then raise exception 'Only one skin 2 is allowed.'; end if;
  v_total := v_total + (v_skin1 + v_skin2) * public.composite_pasting_rate();

  select unit_id into v_unit from public.inventory_items where id = v_raw;

  if v_id is null then
    insert into public.inventory_items (name, unit_id, default_rate, track_as_inventory, is_composite, created_by)
    values (btrim(p_name), v_unit, v_total, true, true, auth.uid())
    returning id into v_id;
  else
    update public.inventory_items set name = btrim(p_name), default_rate = v_total, is_composite = true, track_as_inventory = true
    where id = v_id and is_composite;
    if not found then raise exception 'That material is not a composite.'; end if;
    delete from public.inventory_composite_parts where item_id = v_id;
  end if;

  for v_part in select * from jsonb_array_elements(p_parts) loop
    if v_part->>'role' = 'jobwork' and (v_part->>'label') in ('Pasting (single side)', 'Pasting (both sides)') then continue; end if;
    v_i := v_i + 1;
    insert into public.inventory_composite_parts (item_id, role, component_item_id, label, unit_cost, sort_order)
    values (v_id, v_part->>'role', nullif(v_part->>'component_item_id', '')::uuid, nullif(btrim(v_part->>'label'), ''),
            coalesce((v_part->>'unit_cost')::numeric, 0), v_i);
  end loop;
  return v_id;
end;
$$;

-- Making a composite costs the materials used, its job works and the pasting at today's rate.
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
  v_skins int;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to make composite materials.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter how many to make.'; end if;
  select name into v_name from public.inventory_items where id = p_item_id and is_composite;
  if v_name is null then raise exception 'That is not a composite material.'; end if;
  select id into v_loc from public.inventory_locations where kind = 'company' limit 1;

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

  select count(*) into v_skins from public.inventory_composite_parts where item_id = p_item_id and role in ('skin1', 'skin2');
  select v_unit_cost + coalesce(sum(unit_cost), 0) + v_skins * public.composite_pasting_rate() into v_unit_cost
    from public.inventory_composite_parts where item_id = p_item_id and role = 'jobwork';

  return public.record_inventory_transaction('purchase', p_item_id, v_loc, p_quantity, v_unit_cost,
    p_date, 'adjustment', p_item_id, 'Made from its materials');
end;
$$;
