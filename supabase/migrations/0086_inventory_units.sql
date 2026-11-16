-- Units offered for inventory materials: Sheets, Nos, Sq.ft, R.m, L and Kg, plus any unit added from
-- the inventory screen. Other units (such as Meter and R.ft, used by job-work services) stay as they are
-- but are not offered for materials.
alter table public.units add column if not exists inventory_unit boolean not null default false;

insert into public.units (code, name, description)
select v.code, v.name, v.description
from (values ('LTR', 'L', 'Litres'), ('KG', 'Kg', 'Kilograms')) as v(code, name, description)
where not exists (select 1 from public.units u where u.code = v.code);

update public.units set inventory_unit = true where code in ('SHEET', 'NOS', 'SQFT', 'RM', 'LTR', 'KG');

-- Adds a unit from the inventory screen (or reuses it if the code exists) and offers it for materials.
create or replace function public.add_inventory_unit(p_name text)
returns public.units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.units;
begin
  if not (has_permission('inventory_operate') or has_permission('master_data')) then
    raise exception 'You do not have permission to add units.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the unit name.'; end if;
  v_code := upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]', '', 'g'));
  if v_code = '' then raise exception 'Enter a valid unit name.'; end if;

  select * into v_row from public.units where code = v_code;
  if found then
    update public.units set inventory_unit = true where id = v_row.id returning * into v_row;
    return v_row;
  end if;
  insert into public.units (code, name, description, inventory_unit)
  values (v_code, trim(p_name), trim(p_name), true)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.add_inventory_unit(text) from public, anon;
grant execute on function public.add_inventory_unit(text) to authenticated;
