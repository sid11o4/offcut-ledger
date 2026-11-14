-- Material consumed for factory Internal Orders belongs to the project as well, so every consumption
-- at the project's stock counts as project expense at its booked cost.
create or replace function public.report_design_project_financials(p_design_project_id uuid)
returns table(
  budget numeric, supplier_bills_total numeric, internal_order_total numeric,
  current_inventory_value numeric, inventory_in_value numeric, direct_expenses_total numeric,
  materials_consumed_total numeric
)
language sql
stable
set search_path = public
as $function$
  select
    dp.budget,
    coalesce((select sum(b.grand_total) from public.supplier_bills b
      where b.design_project_id = dp.id and b.status = 'approved'), 0),
    coalesce((select sum(e.total_amount) from public.job_work_entries e
      where e.project_id = dp.factory_project_id and e.billed and e.status = 'active'), 0),
    coalesce((select sum(st.quantity * st.avg_unit_cost) from public.inventory_stock st
      join public.inventory_locations loc on loc.id = st.location_id
      where loc.design_project_id = dp.id), 0),
    coalesce((select sum(t.total_cost) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type in ('purchase', 'transfer_in')), 0),
    coalesce((select sum(x.amount) from public.design_build_expenses x
      where x.design_project_id = dp.id and x.status = 'active'), 0),
    coalesce((select sum(abs(t.total_cost)) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type = 'consumption'), 0)
  from public.design_projects dp
  where dp.id = p_design_project_id;
$function$;

revoke all on function public.report_design_project_financials(uuid) from public, anon;
grant execute on function public.report_design_project_financials(uuid) to authenticated;
