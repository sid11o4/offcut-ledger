-- A proper transaction-level ledger (owner's request, Oct 2026): every money-in and money-out
-- event in one chronological list, not grouped by category like the existing Income/Expense
-- Statement. Covers both Factory and Design Build, since Internal Order job-work already bills
-- through the same `bills` table -- there's nothing Design-Build-specific to add on the income
-- side, only on the outgo side (supplier payments, which Factory's own statement never saw).
--
-- Money in: issued bills (accrual at the point of billing, same recognition point as
-- income_expense_statement() already uses -- not cash receipt, since Factory tracks no
-- separate receipt date). Excludes cancelled bills.
-- Money out: active expenses, plus supplier bill payments that represent an actual cash
-- movement -- cash (confirmed the instant it's recorded) and bank transfers only once
-- bank-confirmed. A 'credit' allocation is a deferred liability, not a cash event, so it's
-- left out of this ledger entirely; it appears here only once/if a later payment settles it
-- with its own cash or bank-confirmed row.
--
-- language sql / not security definer: relies on the caller's own RLS on bills/expenses/
-- supplier_bills/supplier_bill_payments, same invoker-rights pattern as every other reporting
-- RPC in 0036 -- a caller without billing/financial_reports simply sees no bill rows, etc.
create or replace function public.income_expense_ledger(p_start date, p_end date)
returns table (
  txn_date date,
  direction text,
  category text,
  description text,
  reference text,
  amount numeric,
  reference_type text,
  reference_id uuid
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

  union all

  select coalesce(pay.confirmed_at::date, pay.created_at::date), 'out', 'Supplier Payment',
    coalesce(s.name, sb.supplier_text, 'Supplier') || ' — ' || sb.internal_bill_number
      || case when sb.design_project_id is not null then ' (' || dp.name || ')' else '' end,
    sb.internal_bill_number, pay.allocated_amount, 'supplier_bill_payment', pay.id
  from public.supplier_bill_payments pay
  join public.supplier_bills sb on sb.id = pay.bill_id
  left join public.suppliers s on s.id = sb.supplier_id
  left join public.design_projects dp on dp.id = sb.design_project_id
  where sb.status = 'approved'
    and pay.mode in ('cash', 'rtgs_neft') and (pay.mode = 'cash' or pay.confirmed)
    and coalesce(pay.confirmed_at::date, pay.created_at::date) between p_start and p_end

  order by 1 desc;
$$;

grant execute on function public.income_expense_ledger(date, date) to authenticated;
