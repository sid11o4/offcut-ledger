-- Ledger of money moved by RTGS/NEFT only.
--   out: RTGS/NEFT supplier payments that have been matched to a bank statement line, dated and
--        valued as the bank shows them.
--   in : project collections received by RTGS/NEFT (not voided).
create or replace function public.rtgs_ledger(p_start date, p_end date)
returns table(txn_date date, direction text, party text, detail text, reference text, project_name text, amount numeric, reference_type text, reference_id uuid)
language sql
stable
set search_path = public
as $$
  select bt.txn_date, 'out',
    coalesce(s.name, sb.supplier_text, 'Vendor not recorded'),
    sb.internal_bill_number,
    coalesce(bt.utr_reference, pay.utr_reference),
    dp.name, bt.debit_amount, 'supplier_bill_payment', pay.id
  from public.supplier_bill_payments pay
  join public.bank_transactions bt on bt.id = pay.bank_transaction_id
  join public.supplier_bills sb on sb.id = pay.bill_id and sb.status <> 'void'
  left join public.suppliers s on s.id = sb.supplier_id
  left join public.design_projects dp on dp.id = sb.design_project_id
  where pay.mode = 'rtgs_neft' and pay.confirmed
    and bt.txn_date between p_start and p_end
  union all
  select pc.receipt_date, 'in',
    coalesce(nullif(pc.received_from, ''), dp.name),
    pc.receipt_no, pc.reference, dp.name, pc.amount, 'project_collection', pc.id
  from public.project_collections pc
  join public.design_projects dp on dp.id = pc.design_project_id
  where pc.mode = 'rtgs_neft' and not pc.voided
    and pc.receipt_date between p_start and p_end
  order by 1 desc;
$$;

revoke all on function public.rtgs_ledger(date, date) from public, anon;
grant execute on function public.rtgs_ledger(date, date) to authenticated;
