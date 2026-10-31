-- Complete a Design Build project. Any stock still held at the project's location moves to Company
-- inventory through record_inventory_transfer, so cost follows the stock as it does for a manual
-- transfer. The project is then marked completed and drops out of the project lists and the
-- company inventory tiles, unless the user asks to see completed projects.
--
-- A project with pending supplier bills is refused: those bills would then sit against a project
-- that no longer takes work. Approve or delete them first.
create or replace function public.complete_design_project(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_project_loc uuid;
  v_company_loc uuid;
  v_moved integer := 0;
  r record;
begin
  if not public.has_permission('design_build_manage') then
    raise exception 'You do not have permission to complete Design Build projects.';
  end if;

  select status into v_status from public.design_projects where id = p_project_id for update;
  if v_status is null then raise exception 'Project not found.'; end if;
  if v_status = 'completed' then raise exception 'This project is already completed.'; end if;

  if exists (select 1 from public.supplier_bills where design_project_id = p_project_id and status = 'pending_review') then
    raise exception 'This project has supplier bills waiting for review. Approve or delete them before completing the project.';
  end if;

  select id into v_company_loc from public.inventory_locations where kind = 'company' limit 1;
  if v_company_loc is null then raise exception 'No company inventory location exists to receive the stock.'; end if;

  select id into v_project_loc from public.inventory_locations where design_project_id = p_project_id;
  if v_project_loc is not null then
    for r in
      select item_id, quantity from public.inventory_stock
      where location_id = v_project_loc and quantity > 0
    loop
      perform public.record_inventory_transfer(
        p_item_id => r.item_id,
        p_from_location_id => v_project_loc,
        p_to_location_id => v_company_loc,
        p_quantity => r.quantity,
        p_notes => 'Project completed: stock moved to company inventory'
      );
      v_moved := v_moved + 1;
    end loop;
  end if;

  update public.design_projects set status = 'completed' where id = p_project_id;
  return v_moved;
end;
$$;

revoke execute on function public.complete_design_project(uuid) from public, anon;
grant execute on function public.complete_design_project(uuid) to authenticated;
