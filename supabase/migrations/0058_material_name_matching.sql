-- Material names are matched ignoring case, spaces, punctuation and word order. The key is the sorted
-- letters and digits of the name, so "Century 16MM MR", "century 16mm mr" and "MR 16MM CENTURY" are the
-- same material. ensure_inventory_item uses it, so a material typed in a purchase is never duplicated.
create or replace function public.inventory_name_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(c, '' order by c), '')
  from regexp_split_to_table(lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g')), '') c
  where c <> '';
$$;

create or replace function public.ensure_inventory_item(p_name text, p_unit_code text default 'SHEET')
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
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  if v_name = '' or v_key = '' then raise exception 'A material name is required.'; end if;

  select id into v_id from public.inventory_items
    where public.inventory_name_key(name) = v_key and active
    order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_unit from public.units where code = p_unit_code and active;
  if v_unit is null then raise exception 'Unit % is not set up.', p_unit_code; end if;

  insert into public.inventory_items (name, unit_id, track_as_inventory, created_by)
  values (v_name, v_unit, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
