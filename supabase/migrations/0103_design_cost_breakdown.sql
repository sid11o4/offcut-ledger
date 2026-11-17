-- Design Build costs in one set of groups, used by every report and dashboard:
--   Labour; Materials (Raw Board, Edgeband, Skin, Adhesives, Others); Factory Job Work; Transport; Miscellaneous.
-- New bill cost heads: adhesives, transport, miscellaneous.

alter table public.supplier_bill_items drop constraint if exists chk_bill_item_cost_head;
alter table public.supplier_bills drop constraint if exists chk_cost_heads_valid;
alter table public.supplier_bill_items add constraint chk_bill_item_cost_head check (
  cost_head is null or cost_head in ('raw_boards', 'skins', 'edgeband', 'adhesives', 'hardware', 'other',
    'transport', 'miscellaneous', 'factory_labour', 'site_labour', 'employee_salary')
);
alter table public.supplier_bills add constraint chk_cost_heads_valid check (
  cost_heads <@ array['raw_boards', 'skins', 'edgeband', 'adhesives', 'hardware', 'other',
    'transport', 'miscellaneous', 'factory_labour', 'site_labour', 'employee_salary']::text[]
);

-- The group (and sub-group for materials) of a bill line's cost head.
create or replace function public.design_cost_group_of_head(p_head text, p_item_type text)
returns text[]
language sql
immutable
as $$
  select case p_head
    when 'raw_boards' then array['Materials', 'Raw Board']
    when 'edgeband' then array['Materials', 'Edgeband']
    when 'skins' then array['Materials', 'Skin']
    when 'adhesives' then array['Materials', 'Adhesives']
    when 'hardware' then array['Materials', 'Others']
    when 'other' then array['Materials', 'Others']
    when 'factory_labour' then array['Labour', null]
    when 'site_labour' then array['Labour', null]
    when 'employee_salary' then array['Labour', null]
    when 'transport' then array['Transport', null]
    when 'miscellaneous' then array['Miscellaneous', null]
    else case when p_item_type = 'labour' then array['Labour', null] else array['Materials', 'Others'] end
  end;
$$;

-- The group of a Design Build expense category.
create or replace function public.design_cost_group_of_expense(p_name text)
returns text[]
language sql
immutable
as $$
  select case
    when p_name in ('Labour', 'Fixed Salaries') then array['Labour', null]
    when p_name = 'Transport' then array['Transport', null]
    when p_name = 'Consumables' then array['Materials', 'Adhesives']
    else array['Miscellaneous', null]
  end;
$$;

-- The materials sub-group of an inventory item, by its category and name.
create or replace function public.design_cost_sub_of_item(p_category text, p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_category = 'Raw Boards' then 'Raw Board'
    when p_category = 'Skins' then 'Skin'
    when p_category = 'Edgeband' then 'Edgeband'
    when p_name ~* '(fevicol|adhesive|glue|gum)' then 'Adhesives'
    else 'Others'
  end;
$$;

-- Every Design Build cost, by project (null = company), group and sub-group. Optional project and period.
-- Material from stock counts when consumed; a composite is split into its raw board, skins and job work.
create or replace function public.design_build_cost_breakdown(p_project uuid default null, p_start date default null, p_end date default null)
returns table(design_project_id uuid, project_name text, grp text, subgrp text, amount numeric)
language sql
stable
set search_path = public
as $$
  with rate as (select public.composite_pasting_rate() as pasting),
  part_share as (
    -- per composite item: each part's share of its unit value
    select i.id as item_id, p.role, p.unit_cost,
      (sum(p.unit_cost) over (partition by i.id)
        + (select count(*) from public.inventory_composite_parts q where q.item_id = i.id and q.role in ('skin1','skin2')) * (select pasting from rate)) as total_value,
      (select count(*) from public.inventory_composite_parts q where q.item_id = i.id and q.role in ('skin1','skin2')) * (select pasting from rate) as pasting_value
    from public.inventory_items i join public.inventory_composite_parts p on p.item_id = i.id
    where i.is_composite
  ),
  src as (
    -- non-stock supplier bill lines
    select b.design_project_id as dp,
      (public.design_cost_group_of_head(i.cost_head, i.item_type))[1] as grp,
      (public.design_cost_group_of_head(i.cost_head, i.item_type))[2] as subgrp,
      i.total_amount as amount, b.bill_date as dt
    from public.supplier_bill_items i join public.supplier_bills b on b.id = i.bill_id
    where b.status = 'approved' and i.inventory_item_id is null
    union all
    -- Factory job work (Design Build Order), counted when logged
    select dp.id, 'Factory Job Work', null, e.total_amount, e.entry_date
    from public.job_work_entries e join public.design_projects dp on dp.factory_project_id = e.project_id
    where e.status = 'active'
    union all
    -- direct expenses, labour entries included
    select x.design_project_id,
      (public.design_cost_group_of_expense(c.name))[1], (public.design_cost_group_of_expense(c.name))[2],
      x.amount, x.expense_date
    from public.design_build_expenses x left join public.expense_categories c on c.id = x.category_id
    where x.status = 'active'
    union all
    -- simple materials consumed from a project's stock
    select loc.design_project_id, 'Materials', public.design_cost_sub_of_item(it.category, it.name), abs(t.total_cost), t.txn_date
    from public.inventory_transactions t
    join public.inventory_locations loc on loc.id = t.location_id and loc.design_project_id is not null
    join public.inventory_items it on it.id = t.item_id and not it.is_composite
    where t.txn_type = 'consumption' and t.reversed_by is null
    union all
    -- composites consumed: raw board, skins, and the job work built into them
    select loc.design_project_id,
      case when ps.role in ('raw', 'skin1', 'skin2') then 'Materials' else 'Factory Job Work' end,
      case ps.role when 'raw' then 'Raw Board' when 'skin1' then 'Skin' when 'skin2' then 'Skin' end,
      abs(t.total_cost) * ps.unit_cost / nullif(ps.total_value, 0), t.txn_date
    from public.inventory_transactions t
    join public.inventory_locations loc on loc.id = t.location_id and loc.design_project_id is not null
    join part_share ps on ps.item_id = t.item_id
    where t.txn_type = 'consumption' and t.reversed_by is null
    union all
    select loc.design_project_id, 'Factory Job Work', null,
      abs(t.total_cost) * ps.pasting_value / nullif(ps.total_value, 0), t.txn_date
    from public.inventory_transactions t
    join public.inventory_locations loc on loc.id = t.location_id and loc.design_project_id is not null
    join (select distinct item_id, total_value, pasting_value from part_share) ps on ps.item_id = t.item_id
    where t.txn_type = 'consumption' and t.reversed_by is null and ps.pasting_value > 0
  )
  select s.dp, dp.name, s.grp, s.subgrp, round(sum(s.amount), 2)
  from src s left join public.design_projects dp on dp.id = s.dp
  where (p_project is null or s.dp = p_project)
    and (p_start is null or s.dt >= p_start) and (p_end is null or s.dt <= p_end)
  group by s.dp, dp.name, s.grp, s.subgrp
  having sum(s.amount) <> 0;
$$;
grant execute on function public.design_build_cost_breakdown(uuid, date, date) to authenticated;
