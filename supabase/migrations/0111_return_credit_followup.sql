-- Following up a return to a supplier: the signed slip is filed, the vendor's credit note is recorded (it
-- can be for less than the stock's value), and the credit is settled, either refunded by the vendor or
-- adjusted against one of their bills. Until it is settled the credit stays on the vendor's account and
-- shows against Pending Payables. A follow-up log keeps the calls and the next date to chase.
alter table public.supplier_return_slips
  add column if not exists credit_status text not null default 'awaiting_credit'
    check (credit_status in ('awaiting_credit', 'credit_received', 'settled')),
  add column if not exists credit_note_number text,
  add column if not exists credit_note_date date,
  add column if not exists credit_amount numeric(14,2),
  add column if not exists credit_settled_how text check (credit_settled_how in ('refunded', 'adjusted')),
  add column if not exists credit_settled_on date,
  add column if not exists credit_settled_reference text,
  add column if not exists adjusted_bill_id uuid references public.supplier_bills(id),
  add column if not exists next_follow_up_on date;

create table if not exists public.supplier_return_followups (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.supplier_return_slips(id) on delete cascade,
  note text not null,
  next_follow_up_on date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_return_followups_slip on public.supplier_return_followups(slip_id);
alter table public.supplier_return_followups enable row level security;
create policy return_followups_select on public.supplier_return_followups for select
  using (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));

create or replace function public.record_return_credit_note(p_slip_id uuid, p_number text, p_date date, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to record a credit note.';
  end if;
  if coalesce(btrim(p_number), '') = '' then raise exception 'Enter the credit note number.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the credit amount.'; end if;
  update public.supplier_return_slips
    set credit_status = 'credit_received', credit_note_number = btrim(p_number),
        credit_note_date = coalesce(p_date, current_date), credit_amount = p_amount
    where id = p_slip_id and credit_status = 'awaiting_credit';
  if not found then raise exception 'That return is not waiting for a credit note.'; end if;
end;
$$;

create or replace function public.settle_return_credit(p_slip_id uuid, p_how text, p_reference text, p_on date, p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip public.supplier_return_slips;
  v_bill public.supplier_bills;
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to settle a return credit.';
  end if;
  select * into v_slip from public.supplier_return_slips where id = p_slip_id for update;
  if v_slip.id is null then raise exception 'Return not found.'; end if;
  if v_slip.credit_status <> 'credit_received' then raise exception 'Record the vendor''s credit note first.'; end if;
  if p_how not in ('refunded', 'adjusted') then raise exception 'Say whether the credit was refunded or adjusted against a bill.'; end if;
  if p_how = 'adjusted' then
    select * into v_bill from public.supplier_bills where id = p_bill_id;
    if v_bill.id is null or v_bill.supplier_id <> v_slip.supplier_id or v_bill.status <> 'approved' then
      raise exception 'Choose an approved bill of the same vendor to adjust the credit against.';
    end if;
  elsif coalesce(btrim(p_reference), '') = '' then
    raise exception 'Enter the reference of the refund (UTR or receipt).';
  end if;
  update public.supplier_return_slips
    set credit_status = 'settled', credit_settled_how = p_how, credit_settled_on = coalesce(p_on, current_date),
        credit_settled_reference = nullif(btrim(coalesce(p_reference, '')), ''),
        adjusted_bill_id = case when p_how = 'adjusted' then p_bill_id end, next_follow_up_on = null
    where id = p_slip_id;
end;
$$;

create or replace function public.log_return_followup(p_slip_id uuid, p_note text, p_next date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to follow up a return.';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write what was followed up.'; end if;
  insert into public.supplier_return_followups (slip_id, note, next_follow_up_on) values (p_slip_id, btrim(p_note), p_next);
  update public.supplier_return_slips set next_follow_up_on = p_next where id = p_slip_id;
end;
$$;

revoke all on function public.record_return_credit_note(uuid, text, date, numeric) from public, anon;
revoke all on function public.settle_return_credit(uuid, text, text, date, uuid) from public, anon;
revoke all on function public.log_return_followup(uuid, text, date) from public, anon;
grant execute on function public.record_return_credit_note(uuid, text, date, numeric) to authenticated;
grant execute on function public.settle_return_credit(uuid, text, text, date, uuid) to authenticated;
grant execute on function public.log_return_followup(uuid, text, date) to authenticated;

-- Pending payables: a bill's balance is reduced by credit adjusted against it, and credit still waiting to
-- be settled shows as a negative line for the vendor.
drop function if exists public.pending_payables();
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
    coalesce(pay.paid, 0) + coalesce(pay.waived, 0) + coalesce(pay.credited, 0),
    b.grand_total - coalesce(pay.paid, 0) - coalesce(pay.waived, 0) - coalesce(pay.credited, 0),
    coalesce(pay.awaiting, 0),
    b.id
  from public.supplier_bills b
  left join public.suppliers s on s.id = b.supplier_id
  left join public.design_projects dp on dp.id = b.design_project_id
  left join lateral (
    select
      sum(case when p.mode = 'cash' or (p.mode = 'rtgs_neft' and p.confirmed) then p.allocated_amount else 0 end) as paid,
      sum(case when p.mode = 'waiver' then p.allocated_amount else 0 end) as waived,
      sum(case when p.mode = 'rtgs_neft' and not p.confirmed then p.allocated_amount else 0 end) as awaiting,
      (select coalesce(sum(coalesce(r.credit_amount, r.total_amount)), 0) from public.supplier_return_slips r
        where r.adjusted_bill_id = b.id and r.credit_status = 'settled') as credited
    from (select 1) one left join public.supplier_bill_payments p on p.bill_id = b.id
  ) pay on true
  where b.status = 'approved'
    and b.grand_total - coalesce(pay.paid, 0) - coalesce(pay.waived, 0) - coalesce(pay.credited, 0) > 0.5
  union all
  select
    'Return credit',
    coalesce(s.name, 'Vendor not recorded'),
    dp.name,
    r.slip_number,
    r.return_date,
    -coalesce(r.credit_amount, r.total_amount),
    0::numeric,
    -coalesce(r.credit_amount, r.total_amount),
    0::numeric,
    null::uuid
  from public.supplier_return_slips r
  left join public.suppliers s on s.id = r.supplier_id
  left join public.inventory_locations loc on loc.id = r.location_id
  left join public.design_projects dp on dp.id = loc.design_project_id
  where r.credit_status <> 'settled' and coalesce(r.credit_amount, r.total_amount) > 0.5
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
