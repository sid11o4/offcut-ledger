-- Materials a project already used before the system held its stock. They are a project cost (material and
-- quantity at a rate), but they are NOT taken from inventory: nothing here moves stock. Job work is not
-- added either; it is billed separately. Used for the past consumption lists of C1 and B2, and later for edgeband.
create table if not exists public.past_material_consumption (
  id uuid primary key default gen_random_uuid(),
  design_project_id uuid not null references public.design_projects(id),
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  consumed_on date not null default current_date,
  note text,
  voided boolean not null default false,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_past_consumption_project on public.past_material_consumption(design_project_id);
alter table public.past_material_consumption enable row level security;
create policy past_consumption_select on public.past_material_consumption for select
  using (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')
         or public.has_permission('financial_reports') or public.has_permission('design_build_manage'));

-- The cost reports and the project financials count it as material consumed.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.design_build_cost_breakdown(uuid, date, date)'::regprocedure);
  execute replace(d, E'    select dp.id, ''Factory Job Work'', null, e.total_amount, e.entry_date',
    E'    select p.design_project_id, ''Materials'', public.design_cost_sub_of_item(it.category, it.name), p.total_cost, p.consumed_on\n    from public.past_material_consumption p join public.inventory_items it on it.id = p.item_id where not p.voided\n    union all\n    select dp.id, ''Factory Job Work'', null, e.total_amount, e.entry_date');
  d := pg_get_functiondef('public.report_design_project_financials(uuid)'::regprocedure);
  execute replace(d, E'where loc.design_project_id = dp.id and t.txn_type = ''consumption'' and t.reversed_by is null), 0),',
    E'where loc.design_project_id = dp.id and t.txn_type = ''consumption'' and t.reversed_by is null), 0)\n      + coalesce((select sum(p.total_cost) from public.past_material_consumption p where p.design_project_id = dp.id and not p.voided), 0),');
end $$;
