-- Reporting engine (spec sections 17-19, 43). Aggregation happens in Postgres so the browser
-- never has to pull raw transaction rows to sum them; every function takes a date range and
-- returns already-grouped totals.

create or replace function public.report_revenue_by_project(p_start date, p_end date)
returns table (project_id uuid, project_code text, project_name text, client_name text, entry_count bigint, revenue numeric)
language sql stable as $$
  select p.id, p.code, p.name, c.name, count(e.id), coalesce(sum(e.total_amount), 0)
  from public.projects p
  join public.clients c on c.id = p.client_id
  left join public.job_work_entries e
    on e.project_id = p.id and e.status = 'active' and e.entry_date between p_start and p_end
  group by p.id, p.code, p.name, c.name
  having count(e.id) > 0
  order by coalesce(sum(e.total_amount), 0) desc;
$$;

create or replace function public.report_revenue_by_service(p_start date, p_end date)
returns table (service_id uuid, service_code text, service_name text, entry_count bigint, total_quantity numeric, unit_code text, revenue numeric)
language sql stable as $$
  select s.id, s.code, s.name, count(e.id), coalesce(sum(e.base_quantity), 0), u.code, coalesce(sum(e.total_amount), 0)
  from public.job_work_services s
  join public.units u on u.id = s.unit_id
  join public.job_work_entries e on e.service_id = s.id and e.status = 'active' and e.entry_date between p_start and p_end
  group by s.id, s.code, s.name, u.code
  order by coalesce(sum(e.total_amount), 0) desc;
$$;

create or replace function public.report_revenue_by_process(p_start date, p_end date)
returns table (process_id uuid, process_code text, process_name text, total_quantity numeric, revenue numeric)
language sql stable as $$
  select pr.id, pr.code, pr.name, coalesce(sum(c.component_quantity), 0), coalesce(sum(c.amount), 0)
  from public.processes pr
  join public.job_work_entry_components c on c.process_id = pr.id
  join public.job_work_entries e on e.id = c.entry_id and e.status = 'active' and e.entry_date between p_start and p_end
  group by pr.id, pr.code, pr.name
  order by coalesce(sum(c.amount), 0) desc;
$$;

create or replace function public.report_revenue_by_machine(p_start date, p_end date)
returns table (machine_id uuid, machine_code text, machine_name text, total_quantity numeric, revenue numeric)
language sql stable as $$
  select m.id, m.code, m.name, coalesce(sum(c.component_quantity), 0), coalesce(sum(c.amount), 0)
  from public.machines m
  join public.job_work_entry_components c on c.machine_id = m.id
  join public.job_work_entries e on e.id = c.entry_id and e.status = 'active' and e.entry_date between p_start and p_end
  group by m.id, m.code, m.name
  order by coalesce(sum(c.amount), 0) desc;
$$;

create or replace function public.report_revenue_by_rate_category(p_start date, p_end date)
returns table (rate_category_id uuid, rate_category_code text, rate_category_name text, entry_count bigint, revenue numeric)
language sql stable as $$
  select rc.id, rc.code, rc.name, count(e.id), coalesce(sum(e.total_amount), 0)
  from public.rate_categories rc
  join public.job_work_entries e on e.rate_category_id = rc.id and e.status = 'active' and e.entry_date between p_start and p_end
  group by rc.id, rc.code, rc.name
  order by coalesce(sum(e.total_amount), 0) desc;
$$;

create or replace function public.report_revenue_by_date(p_start date, p_end date)
returns table (entry_date date, entry_count bigint, revenue numeric)
language sql stable as $$
  select e.entry_date, count(*), coalesce(sum(e.total_amount), 0)
  from public.job_work_entries e
  where e.status = 'active' and e.entry_date between p_start and p_end
  group by e.entry_date
  order by e.entry_date;
$$;

create or replace function public.report_billing_status(p_start date, p_end date)
returns table (billed_revenue numeric, unbilled_revenue numeric, billed_count bigint, unbilled_count bigint)
language sql stable as $$
  select
    coalesce(sum(total_amount) filter (where billed), 0),
    coalesce(sum(total_amount) filter (where not billed), 0),
    count(*) filter (where billed),
    count(*) filter (where not billed)
  from public.job_work_entries
  where status = 'active' and entry_date between p_start and p_end;
$$;

-- Project reconciliation (spec section 46): actual work revenue vs billed vs unbilled,
-- always derived from job_work_entries -- never a manually-entered total.
create or replace function public.project_financials(p_project_id uuid)
returns table (
  actual_revenue numeric, billed_revenue numeric, unbilled_revenue numeric,
  total_expenses numeric, estimated_value numeric
)
language sql stable as $$
  select
    coalesce((select sum(total_amount) from public.job_work_entries where project_id = p_project_id and status = 'active'), 0),
    coalesce((select sum(total_amount) from public.job_work_entries where project_id = p_project_id and status = 'active' and billed), 0),
    coalesce((select sum(total_amount) from public.job_work_entries where project_id = p_project_id and status = 'active' and not billed), 0),
    coalesce((select sum(amount) from public.expenses where project_id = p_project_id and status = 'active'), 0),
    coalesce((select sum(grand_total) from public.estimates where project_id = p_project_id and status not in ('cancelled','rejected')), 0);
$$;

-- Income/Expense statement for an arbitrary period (spec sections 33-34, 47). Uses each
-- transaction's own effective date (entry_date / expense_date), never the row's created_at.
-- Callers should invoke sync_recurring_expenses(p_end) first so due recurring instances for
-- the period actually exist as expense rows before this runs.
create or replace function public.income_expense_statement(p_start date, p_end date)
returns table (
  job_work_income numeric,
  variable_expenses numeric,
  recurring_expenses numeric,
  total_expenses numeric,
  net_contribution numeric
)
language sql stable as $$
  with income as (
    select coalesce(sum(total_amount), 0) as amt
    from public.job_work_entries
    where status = 'active' and entry_date between p_start and p_end
  ),
  variable as (
    select coalesce(sum(amount), 0) as amt
    from public.expenses
    where status = 'active' and source = 'manual' and expense_date between p_start and p_end
  ),
  recurring as (
    select coalesce(sum(amount), 0) as amt
    from public.expenses
    where status = 'active' and source = 'recurring' and expense_date between p_start and p_end
  )
  select
    income.amt,
    variable.amt,
    recurring.amt,
    variable.amt + recurring.amt,
    income.amt - (variable.amt + recurring.amt)
  from income, variable, recurring;
$$;

create or replace function public.expense_breakdown_by_category(p_start date, p_end date)
returns table (category_id uuid, category_code text, category_name text, amount numeric)
language sql stable as $$
  select ec.id, ec.code, ec.name, coalesce(sum(ex.amount), 0)
  from public.expense_categories ec
  join public.expenses ex on ex.category_id = ec.id and ex.status = 'active' and ex.expense_date between p_start and p_end
  group by ec.id, ec.code, ec.name
  order by coalesce(sum(ex.amount), 0) desc;
$$;
