-- Payables and receivables per Design Build project.
--  vendor payable: approved vendor and FORMGRID bills less cash and confirmed RTGS/NEFT payments and waivers.
--  labour payable: labour earned (shifts net of advance repaid, bonuses and other) less advances still owed back.
--  receivable: contract value less what the client has paid.
create or replace function public.design_build_payables_receivables()
returns table(design_project_id uuid, vendor_payable numeric, labour_payable numeric, contract_total numeric, received_total numeric, receivable numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    coalesce((
      select sum(b.grand_total - coalesce(pay.paid, 0) - coalesce(pay.waived, 0))
      from public.supplier_bills b
      left join lateral (
        select
          sum(case when p.mode = 'cash' or (p.mode = 'rtgs_neft' and p.confirmed) then p.allocated_amount else 0 end) as paid,
          sum(case when p.mode = 'waiver' then p.allocated_amount else 0 end) as waived
        from public.supplier_bill_payments p
        where p.bill_id = b.id
      ) pay on true
      where b.design_project_id = d.id and b.status = 'approved'
    ), 0),
    coalesce((
      select sum(case when l.kind in ('shift', 'bonus', 'other') then l.amount else 0 end)
           - sum(case when l.kind = 'advance' then l.amount else 0 end)
           + sum(l.recovery)
      from public.labour_entries l
      where l.design_project_id = d.id and l.status = 'active'
    ), 0),
    c.contract_total,
    c.received_total,
    c.balance_due
  from public.design_projects d
  cross join lateral public.project_contract_summary(d.id) c
$$;

revoke all on function public.design_build_payables_receivables() from public, anon;
grant execute on function public.design_build_payables_receivables() to authenticated;
