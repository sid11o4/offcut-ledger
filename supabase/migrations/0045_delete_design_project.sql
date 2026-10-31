-- Delete a Design Build project, but only when no history refers to it. A project's stock location
-- is created with the project and is empty until stock moves, so an empty location is removed with
-- the project. Supplier bills, inventory slips, or any stock movement keep their history against the
-- project, so the delete is refused rather than losing those records.
create or replace function public.delete_design_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('design_build_manage') then
    raise exception 'You do not have permission to delete Design Build projects.';
  end if;
  if exists (select 1 from public.supplier_bills where design_project_id = p_project_id) then
    raise exception 'This project has supplier bills. It can only be deleted when it has none.';
  end if;
  if exists (select 1 from public.inventory_slips where design_project_id = p_project_id) then
    raise exception 'This project has inventory slips. It can only be deleted when it has none.';
  end if;
  if exists (
    select 1 from public.inventory_transactions t
    join public.inventory_locations l on l.id = t.location_id
    where l.design_project_id = p_project_id
  ) then
    raise exception 'This project has stock movements. It can only be deleted when it has none.';
  end if;
  delete from public.inventory_stock s
    using public.inventory_locations l
    where s.location_id = l.id and l.design_project_id = p_project_id;
  delete from public.inventory_locations where design_project_id = p_project_id;
  delete from public.design_projects where id = p_project_id;
end;
$$;

revoke execute on function public.delete_design_project(uuid) from public, anon;
grant execute on function public.delete_design_project(uuid) to authenticated;
