-- Design Build expenses. A Factory expense stays in public.expenses. An expense charged to Design Build
-- is kept here, either for the Design Build company as a whole (design_project_id null) or for one
-- Design Build project. Factory reports never read this table; Design Build reports read it.

create table if not exists public.design_build_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  description text,
  design_project_id uuid references public.design_projects(id),
  payment_reference text,
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);

create index if not exists idx_db_expenses_project on public.design_build_expenses (design_project_id);
create index if not exists idx_db_expenses_date on public.design_build_expenses (expense_date);

alter table public.design_build_expenses enable row level security;

create policy design_build_expenses_select on public.design_build_expenses for select
  using (public.has_permission('design_build_manage') or public.has_permission('financial_reports'));

create policy design_build_expenses_insert on public.design_build_expenses for insert
  with check (public.has_permission('design_build_manage'));

create policy design_build_expenses_update on public.design_build_expenses for update
  using (public.has_permission('design_build_manage'));

create trigger trg_audit_design_build_expenses
  after insert or update or delete on public.design_build_expenses
  for each row execute function public.audit_row_change();

-- Design Build statement: one row per project, plus one for company-level expenses when there are any.
drop function if exists public.design_build_statement(date, date);
create function public.design_build_statement(p_start date, p_end date)
returns table(design_project_id uuid, project_name text, supplier_bills_total numeric, internal_order_total numeric, direct_expenses numeric, total_expense numeric)
language sql
stable
set search_path = public
as $$
  select * from (
    with sb as (
      select design_project_id as pid, sum(grand_total) as bills
      from public.supplier_bills
      where status = 'approved' and bill_date between p_start and p_end
      group by 1
    ),
    io as (
      select dp.id as pid, sum(e.total_amount) as internal
      from public.job_work_entries e
      join public.design_projects dp on dp.factory_project_id = e.project_id
      where e.billed and e.status = 'active' and e.entry_date between p_start and p_end
      group by dp.id
    ),
    de as (
      select design_project_id as pid, sum(amount) as direct
      from public.design_build_expenses
      where status = 'active' and design_project_id is not null and expense_date between p_start and p_end
      group by 1
    )
    select dp.id as design_project_id, dp.name as project_name,
      coalesce(sb.bills, 0), coalesce(io.internal, 0), coalesce(de.direct, 0),
      coalesce(sb.bills, 0) + coalesce(io.internal, 0) + coalesce(de.direct, 0)
    from public.design_projects dp
    left join sb on sb.pid = dp.id
    left join io on io.pid = dp.id
    left join de on de.pid = dp.id

    union all

    select null::uuid, 'Company (not tied to a project)'::text, 0::numeric, 0::numeric,
      sum(amount), sum(amount)
    from public.design_build_expenses
    where status = 'active' and design_project_id is null and expense_date between p_start and p_end
    having count(*) > 0
  ) s
  order by (s.design_project_id is null), s.project_name;
$$;

-- Design Build ledger: adds the expenses charged to Design Build to the payments and job-work lines.
create or replace function public.design_build_ledger(p_start date, p_end date)
returns table(txn_date date, category text, description text, reference text, amount numeric, reference_type text, reference_id uuid, design_project_id uuid, project_name text)
language sql
stable
set search_path = public
as $function$
  select coalesce(pay.confirmed_at::date, pay.created_at::date), 'Supplier Payment',
    coalesce(s.name, sb.supplier_text, 'Supplier') || ' — ' || sb.internal_bill_number,
    sb.internal_bill_number, pay.allocated_amount, 'supplier_bill_payment', pay.id,
    sb.design_project_id, dp.name
  from public.supplier_bill_payments pay
  join public.supplier_bills sb on sb.id = pay.bill_id
  left join public.suppliers s on s.id = sb.supplier_id
  left join public.design_projects dp on dp.id = sb.design_project_id
  where sb.status = 'approved'
    and pay.mode in ('cash', 'rtgs_neft') and (pay.mode = 'cash' or pay.confirmed)
    and coalesce(pay.confirmed_at::date, pay.created_at::date) between p_start and p_end

  union all

  select e.entry_date, 'Internal Order',
    'Internal Order job-work — ' || p.name,
    p.code, e.total_amount, 'job_work_entry', e.id, dp.id, dp.name
  from public.job_work_entries e
  join public.design_projects dp on dp.factory_project_id = e.project_id
  join public.projects p on p.id = e.project_id
  where e.billed and e.status = 'active' and e.entry_date between p_start and p_end

  union all

  select x.expense_date, 'Direct Expense',
    coalesce(c.name, 'Expense') || coalesce(' — ' || x.description, ''),
    x.payment_reference, x.amount, 'design_build_expense', x.id, x.design_project_id, dp.name
  from public.design_build_expenses x
  left join public.expense_categories c on c.id = x.category_id
  left join public.design_projects dp on dp.id = x.design_project_id
  where x.status = 'active' and x.expense_date between p_start and p_end

  order by 1 desc;
$function$;

-- Project financials: adds the expenses charged to the project itself.
drop function if exists public.report_design_project_financials(uuid);
create function public.report_design_project_financials(p_design_project_id uuid)
returns table(budget numeric, supplier_bills_total numeric, internal_order_total numeric, current_inventory_value numeric, inventory_in_value numeric, direct_expenses_total numeric)
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
      where x.design_project_id = dp.id and x.status = 'active'), 0)
  from public.design_projects dp
  where dp.id = p_design_project_id;
$function$;

revoke execute on function public.design_build_statement(date, date) from public, anon;
revoke execute on function public.design_build_ledger(date, date) from public, anon;
revoke execute on function public.report_design_project_financials(uuid) from public, anon;
grant execute on function public.design_build_statement(date, date) to authenticated;
grant execute on function public.design_build_ledger(date, date) to authenticated;
grant execute on function public.report_design_project_financials(uuid) to authenticated;
