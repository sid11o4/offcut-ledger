-- A Design Build Order counts as the Design Build project's expense when it is logged in the daily log,
-- not when it is billed, and it is paid on entry. Billing still consumes the inventory.

create or replace function public.report_design_project_financials(p_design_project_id uuid)
returns table(budget numeric, supplier_bills_total numeric, internal_order_total numeric, current_inventory_value numeric, inventory_in_value numeric, direct_expenses_total numeric, materials_consumed_total numeric, bill_expense_total numeric)
language sql
stable
set search_path = 'public'
as $function$
  select
    dp.budget,
    coalesce((select sum(b.grand_total) from public.supplier_bills b
      where b.design_project_id = dp.id and b.status = 'approved'), 0),
    coalesce((select sum(e.total_amount) from public.job_work_entries e
      where e.project_id = dp.factory_project_id and e.status = 'active'), 0),
    coalesce((select sum(st.quantity * st.avg_unit_cost) from public.inventory_stock st
      join public.inventory_locations loc on loc.id = st.location_id
      where loc.design_project_id = dp.id), 0),
    coalesce((select sum(t.total_cost) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type in ('purchase', 'transfer_in') and t.reversed_by is null), 0),
    coalesce((select sum(x.amount) from public.design_build_expenses x
      where x.design_project_id = dp.id and x.status = 'active'), 0),
    coalesce((select sum(abs(t.total_cost)) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type = 'consumption' and t.reversed_by is null), 0),
    coalesce((select sum(i.total_amount) from public.supplier_bill_items i
      join public.supplier_bills b on b.id = i.bill_id
      where b.design_project_id = dp.id and b.status = 'approved' and i.inventory_item_id is null), 0)
  from public.design_projects dp
  where dp.id = p_design_project_id;
$function$;

create or replace function public.design_build_ledger(p_start date, p_end date)
returns table(txn_date date, category text, description text, reference text, amount numeric, reference_type text, reference_id uuid, design_project_id uuid, project_name text)
language sql
stable
set search_path = 'public'
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
  select e.entry_date, 'Design Build Order',
    'Design Build Order job-work — ' || p.name,
    p.code, e.total_amount, 'job_work_entry', e.id, dp.id, dp.name
  from public.job_work_entries e
  join public.design_projects dp on dp.factory_project_id = e.project_id
  join public.projects p on p.id = e.project_id
  where e.status = 'active' and e.entry_date between p_start and p_end
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
