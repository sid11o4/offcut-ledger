-- Factory's ledger no longer carries Design Build supplier payments. Internal Order income stays
-- Factory income (via the bills table); its cost is booked to Design Build below.
create or replace function public.income_expense_ledger(p_start date, p_end date)
returns table (
  txn_date date, direction text, category text, description text,
  reference text, amount numeric, reference_type text, reference_id uuid
)
language sql stable set search_path = public as $$
  select b.bill_date, 'in', 'Billing',
    coalesce(c.name, '') || ' — ' || coalesce(p.name, ''),
    b.bill_number, b.grand_total, 'bill', b.id
  from public.bills b
  join public.clients c on c.id = b.client_id
  join public.projects p on p.id = b.project_id
  where b.status <> 'cancelled' and b.bill_date between p_start and p_end

  union all

  select e.expense_date, 'out', 'Expense',
    coalesce(ec.name, 'Expense') || coalesce(' — ' || e.description, ''),
    ec.name, e.amount, 'expense', e.id
  from public.expenses e
  left join public.expense_categories ec on ec.id = e.category_id
  where e.status = 'active' and e.expense_date between p_start and p_end

  order by 1 desc;
$$;

-- Design Build money-out ledger: supplier payments actually made, plus Internal Order cost,
-- each tagged with the Design Build project it belongs to.
create or replace function public.design_build_ledger(p_start date, p_end date)
returns table (
  txn_date date, category text, description text, reference text, amount numeric,
  reference_type text, reference_id uuid, design_project_id uuid, project_name text
)
language sql stable set search_path = public as $$
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

  order by 1 desc;
$$;

-- Design Build statement (accrual): approved supplier bills plus Internal Order cost, per project.
create or replace function public.design_build_statement(p_start date, p_end date)
returns table (
  design_project_id uuid, project_name text, supplier_bills_total numeric,
  internal_order_total numeric, total_expense numeric
)
language sql stable set search_path = public as $$
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
  )
  select dp.id, dp.name,
    coalesce(sb.bills, 0), coalesce(io.internal, 0),
    coalesce(sb.bills, 0) + coalesce(io.internal, 0)
  from public.design_projects dp
  left join sb on sb.pid = dp.id
  left join io on io.pid = dp.id
  order by dp.name;
$$;

grant execute on function public.income_expense_ledger(date, date) to authenticated;
grant execute on function public.design_build_ledger(date, date) to authenticated;
grant execute on function public.design_build_statement(date, date) to authenticated;
revoke execute on function public.design_build_ledger(date, date) from anon;
revoke execute on function public.design_build_statement(date, date) from anon;
