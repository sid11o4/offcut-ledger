-- Everything still owed: approved supplier bills not yet paid in full (material, labour or both) and labour
-- owed to contractors from their daily entries. A bill counts as paid by cash, by RTGS/NEFT once the bank
-- statement has matched it, or waived; credit and RTGS still waiting for the bank are not paid.
create or replace function public.pending_payables()
returns table(
  kind text, party text, project_name text, ref text, doc_date date,
  total numeric, paid numeric, balance numeric, awaiting_bank numeric, bill_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not (public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports')) then
    raise exception 'You do not have permission to see payables.';
  end if;
  return query
  select
    case b.expense_nature when 'labour' then 'Labour' when 'both' then 'Material + labour' else 'Material' end,
    coalesce(s.name, b.supplier_text, 'Vendor not recorded'),
    dp.name,
    b.internal_bill_number,
    b.bill_date,
    b.grand_total,
    coalesce(pay.paid, 0) + coalesce(pay.waived, 0),
    b.grand_total - coalesce(pay.paid, 0) - coalesce(pay.waived, 0),
    coalesce(pay.awaiting, 0),
    b.id
  from public.supplier_bills b
  left join public.suppliers s on s.id = b.supplier_id
  left join public.design_projects dp on dp.id = b.design_project_id
  left join lateral (
    select
      sum(case when p.mode = 'cash' or (p.mode = 'rtgs_neft' and p.confirmed) then p.allocated_amount else 0 end) as paid,
      sum(case when p.mode = 'waiver' then p.allocated_amount else 0 end) as waived,
      sum(case when p.mode = 'rtgs_neft' and not p.confirmed then p.allocated_amount else 0 end) as awaiting
    from public.supplier_bill_payments p where p.bill_id = b.id
  ) pay on true
  where b.status = 'approved'
    and b.grand_total - coalesce(pay.paid, 0) - coalesce(pay.waived, 0) > 0.5
  union all
  select
    'Labour',
    c.name,
    dp.name,
    'Daily labour entries',
    min(l.entry_date),
    sum(case when l.kind in ('shift', 'bonus', 'other') then l.amount else 0 end) + sum(l.recovery),
    sum(case when l.kind = 'advance' then l.amount else 0 end),
    sum(case when l.kind in ('shift', 'bonus', 'other') then l.amount else 0 end)
      - sum(case when l.kind = 'advance' then l.amount else 0 end) + sum(l.recovery),
    0::numeric,
    null::uuid
  from public.labour_entries l
  join public.labour_contractors c on c.id = l.contractor_id
  left join public.design_projects dp on dp.id = l.design_project_id
  where l.status = 'active' and l.design_project_id is not null
  group by c.name, dp.name, l.design_project_id
  having sum(case when l.kind in ('shift', 'bonus', 'other') then l.amount else 0 end)
       - sum(case when l.kind = 'advance' then l.amount else 0 end) + sum(l.recovery) > 0.5;
end;
$function$;
revoke all on function public.pending_payables() from public, anon;
grant execute on function public.pending_payables() to authenticated;
