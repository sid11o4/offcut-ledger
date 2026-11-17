-- One vendor bill can be split across projects: each line may name its own project.
-- A line with no project of its own follows the bill's project (or Company when the bill has none).
alter table public.supplier_bill_items
  add column if not exists design_project_id uuid references public.design_projects(id);
create index if not exists idx_supplier_bill_items_project on public.supplier_bill_items(design_project_id);

create or replace function public.bill_location_for(p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.inventory_locations
  where (p_project is not null and kind = 'project' and design_project_id = p_project)
     or (p_project is null and kind = 'company')
  limit 1;
$$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'approve_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('v_location_id, v_item.quantity' in d) = 0 then raise exception 'approve marker missing'; end if;
  d := replace(d, 'v_location_id, v_item.quantity', 'public.bill_location_for(coalesce(v_item.design_project_id, v_bill.design_project_id)), v_item.quantity');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'post_unlinked_bill_lines' and pronamespace = 'public'::regnamespace;
  if position('v_item, v_location, v_line.quantity' in d) = 0 then raise exception 'post marker missing'; end if;
  d := replace(d, 'v_item, v_location, v_line.quantity', 'v_item, public.bill_location_for(coalesce(v_line.design_project_id, v_bill.design_project_id)), v_line.quantity');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'design_build_cost_breakdown' and pronamespace = 'public'::regnamespace;
  if position('select b.design_project_id as dp,' in d) = 0 then raise exception 'breakdown marker missing'; end if;
  d := replace(d, 'select b.design_project_id as dp,', 'select coalesce(i.design_project_id, b.design_project_id) as dp,');
  execute d;
end $$;
