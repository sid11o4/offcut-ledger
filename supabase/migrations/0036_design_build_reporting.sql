-- Reporting for the Design Build project dashboard. Reports three figures separately rather
-- than blending them into one "total cost", since a supplier bill against a project can
-- already include materials that are also counted in inventory value -- summing them would
-- double-count. The UI shows all three as a labelled breakdown.

create or replace function public.report_design_project_financials(p_design_project_id uuid)
returns table (
  budget numeric, supplier_bills_total numeric, internal_order_total numeric,
  current_inventory_value numeric, inventory_in_value numeric
)
language sql stable set search_path = public as $$
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
      where loc.design_project_id = dp.id and t.txn_type in ('purchase', 'transfer_in')), 0)
  from public.design_projects dp
  where dp.id = p_design_project_id;
$$;

create or replace function public.report_design_projects_summary()
returns table (
  id uuid, code text, name text, status text, budget numeric,
  supplier_bills_total numeric, internal_order_total numeric, current_inventory_value numeric
)
language sql stable set search_path = public as $$
  select dp.id, dp.code, dp.name, dp.status, dp.budget,
    coalesce((select sum(b.grand_total) from public.supplier_bills b
      where b.design_project_id = dp.id and b.status = 'approved'), 0),
    coalesce((select sum(e.total_amount) from public.job_work_entries e
      where e.project_id = dp.factory_project_id and e.billed and e.status = 'active'), 0),
    coalesce((select sum(st.quantity * st.avg_unit_cost) from public.inventory_stock st
      join public.inventory_locations loc on loc.id = st.location_id
      where loc.design_project_id = dp.id), 0)
  from public.design_projects dp
  order by dp.created_at desc;
$$;

-- Company-pool inventory valuation, for the Company Inventory screen.
create or replace function public.report_company_inventory_value()
returns table (item_id uuid, item_name text, quantity numeric, avg_unit_cost numeric, value numeric)
language sql stable set search_path = public as $$
  select i.id, i.name, st.quantity, st.avg_unit_cost, round(st.quantity * st.avg_unit_cost, 2)
  from public.inventory_stock st
  join public.inventory_locations loc on loc.id = st.location_id and loc.kind = 'company'
  join public.inventory_items i on i.id = st.item_id
  where st.quantity > 0
  order by (st.quantity * st.avg_unit_cost) desc;
$$;

grant execute on function
  public.report_design_project_financials(uuid),
  public.report_design_projects_summary(),
  public.report_company_inventory_value()
to authenticated;
