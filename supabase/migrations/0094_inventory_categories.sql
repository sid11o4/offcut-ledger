-- Inventory is split into Raw Boards, Skins, Edgeband, Hardware and Others. Composite materials are
-- shown as their own group in the app (they are flagged is_composite) and carry no category.

alter table public.inventory_items drop constraint if exists inventory_items_category_check;
alter table public.inventory_items add constraint inventory_items_category_check
  check (category is null or category in ('Raw Boards', 'Skins', 'Edgeband', 'Hardware', 'Others'));

-- Existing materials: the ones entered as opening stock, and the ones past job works used.
update public.inventory_items set category = 'Raw Boards'
  where name in ('Century 16MM MR', 'Century 16MM BWP', 'Century 8MM BWP', '8MM MR', '16MM HDHMR', '18MM MR PLY');
update public.inventory_items set category = 'Skins'
  where name in ('163', '107 FWN', '101', '6965SUD', '3739', '5018', '5671');
update public.inventory_items set category = 'Edgeband'
  where name in ('VENEER', '2013', '137', '116', '75729', '3392 / 3088');
update public.inventory_items set category = 'Others' where name = 'OST' and category is null;

-- Materials created on the spot take the category the caller gives; a material counted in running
-- metres defaults to Edgeband.
drop function if exists public.ensure_inventory_item(text, text);
create or replace function public.ensure_inventory_item(p_name text, p_unit_code text default 'SHEET', p_category text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := public.inventory_name_key(p_name);
  v_unit uuid;
  v_id uuid;
  v_cat text := coalesce(nullif(p_category, ''), case when p_unit_code = 'RM' then 'Edgeband' end);
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  if v_name = '' or v_key = '' then raise exception 'A material name is required.'; end if;

  select id into v_id from public.inventory_items
    where public.inventory_name_key(name) = v_key and active
    order by created_at limit 1;
  if v_id is not null then
    update public.inventory_items set category = v_cat where id = v_id and category is null and v_cat is not null;
    return v_id;
  end if;

  select id into v_unit from public.units where code = p_unit_code and active;
  if v_unit is null then raise exception 'Unit % is not set up.', p_unit_code; end if;

  insert into public.inventory_items (name, unit_id, track_as_inventory, category, created_by)
  values (v_name, v_unit, true, v_cat, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.ensure_inventory_item(text, text, text) from public, anon;
grant execute on function public.ensure_inventory_item(text, text, text) to authenticated;

create or replace function public.set_inventory_category(p_item_id uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('master_data')) then
    raise exception 'You do not have permission to change a material''s category.';
  end if;
  update public.inventory_items set category = nullif(p_category, '') where id = p_item_id and not is_composite;
  if not found then raise exception 'Material not found, or it is a composite.'; end if;
end;
$$;
revoke all on function public.set_inventory_category(uuid, text) from public, anon;
grant execute on function public.set_inventory_category(uuid, text) to authenticated;
