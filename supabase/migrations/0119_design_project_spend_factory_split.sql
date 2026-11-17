-- design_project_spend() now reports Factory job work separately from the other costs (transport, miscellaneous).
drop function if exists public.design_project_spend();
create or replace function public.design_project_spend()
returns table(design_project_id uuid, labour numeric, materials numeric, factory numeric, other numeric, inventory numeric, spent numeric)
language sql
stable
set search_path = public
as $$
  with c as (
    select b.design_project_id as pid, b.grp, sum(b.amount) as amt
    from public.design_build_cost_breakdown(null, null, null) b
    where b.design_project_id is not null
    group by b.design_project_id, b.grp
  ),
  inv as (
    select loc.design_project_id as pid, sum(greatest(st.quantity, 0) * st.avg_unit_cost) as v
    from public.inventory_stock st join public.inventory_locations loc on loc.id = st.location_id
    where loc.design_project_id is not null group by loc.design_project_id
  ),
  t as (
    select pid,
      coalesce(sum(amt) filter (where grp = 'Labour'), 0) as labour,
      coalesce(sum(amt) filter (where grp = 'Materials'), 0) as materials,
      coalesce(sum(amt) filter (where grp = 'Factory Job Work'), 0) as factory,
      coalesce(sum(amt) filter (where grp not in ('Labour', 'Materials', 'Factory Job Work')), 0) as other
    from c group by pid
  )
  select dp.id, coalesce(t.labour, 0), coalesce(t.materials, 0), coalesce(t.factory, 0), coalesce(t.other, 0), coalesce(inv.v, 0),
    coalesce(t.labour, 0) + coalesce(t.materials, 0) + coalesce(t.factory, 0) + coalesce(t.other, 0) + coalesce(inv.v, 0)
  from public.design_projects dp
  left join t on t.pid = dp.id
  left join inv on inv.pid = dp.id;
$$;
grant execute on function public.design_project_spend() to authenticated;
