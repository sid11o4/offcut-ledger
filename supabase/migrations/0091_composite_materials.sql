-- Composite materials: one stock item built from a raw board, a skin on one side, an optional skin
-- on the other side, and the job works already completed on it. Each part carries its cost per unit;
-- the item's value per unit is their sum, and stock entered for the composite is valued at it.

alter table public.inventory_items add column if not exists is_composite boolean not null default false;

create table if not exists public.inventory_composite_parts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  role text not null check (role in ('raw', 'skin1', 'skin2', 'jobwork')),
  component_item_id uuid references public.inventory_items(id),
  label text,
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  sort_order int not null default 0
);
create index if not exists idx_composite_parts_item on public.inventory_composite_parts(item_id);

alter table public.inventory_composite_parts enable row level security;
revoke all on public.inventory_composite_parts from public, anon, authenticated;
grant select on public.inventory_composite_parts to authenticated;
create policy composite_parts_read on public.inventory_composite_parts for select to authenticated using (public.is_active_user());

-- Creates a composite material, or, with p_item_id, replaces its parts and name. The new value only
-- applies to stock entered afterwards; stock already held keeps the value it was entered at.
-- p_parts: [{ "role": "raw|skin1|skin2|jobwork", "component_item_id": uuid?, "label": text?, "unit_cost": number }]
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
    v_i := v_i + 1;
    insert into public.inventory_composite_parts (item_id, role, component_item_id, label, unit_cost, sort_order)
    values (v_id, v_part->>'role', nullif(v_part->>'component_item_id', '')::uuid, nullif(btrim(v_part->>'label'), ''),
            coalesce((v_part->>'unit_cost')::numeric, 0), v_i);
  end loop;
  return v_id;
end;
$$;

revoke all on function public.save_composite_item(uuid, text, jsonb) from public, anon;
grant execute on function public.save_composite_item(uuid, text, jsonb) to authenticated;
