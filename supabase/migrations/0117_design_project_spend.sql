-- A project's spent money is its labour, plus the materials consumed, plus the stock it holds (money put
-- into material that is not used yet). One definition, read by every project page and report.
create or replace function public.design_project_spend()
returns table(design_project_id uuid, labour numeric, materials numeric, inventory numeric, spent numeric)
language sql
stable
set search_path = public
as $$
  with c as (
    select b.design_project_id as pid, b.grp, sum(b.amount) as amt
    from public.design_build_cost_breakdown(null, null, null) b
    where b.design_project_id is not null and b.grp in ('Labour', 'Materials')
    group by b.design_project_id, b.grp
  ),
  inv as (
    select loc.design_project_id as pid, sum(greatest(st.quantity, 0) * st.avg_unit_cost) as v
    from public.inventory_stock st join public.inventory_locations loc on loc.id = st.location_id
    where loc.design_project_id is not null group by loc.design_project_id
  )
  select dp.id,
    coalesce(l.amt, 0), coalesce(m.amt, 0), coalesce(inv.v, 0),
    coalesce(l.amt, 0) + coalesce(m.amt, 0) + coalesce(inv.v, 0)
  from public.design_projects dp
  left join c l on l.pid = dp.id and l.grp = 'Labour'
  left join c m on m.pid = dp.id and m.grp = 'Materials'
  left join inv on inv.pid = dp.id;
$$;
grant execute on function public.design_project_spend() to authenticated;
