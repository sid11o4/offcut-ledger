-- RTGS/NEFT payments stay pending until a bank statement line matches them at 95% or better.
-- A match is the smaller amount divided by the larger (so it works in both directions). The best
-- candidate is the one whose UTR matches, then the closest amount. Each payment and each bank line
-- is used at most once. Payments on voided bills are never matched.

create or replace function public.suggest_bank_matches(p_bank_transaction_id uuid)
returns table (
  payment_id uuid, bill_id uuid, internal_bill_number text, supplier_name text,
  allocated_amount numeric, utr_reference text, utr_matches boolean, amount_diff_pct numeric
)
language sql stable set search_path = public as $$
  select p.id, p.bill_id, b.internal_bill_number, s.name, p.allocated_amount, p.utr_reference,
    (p.utr_reference is not null and p.utr_reference = bt.utr_reference) as utr_matches,
    round(abs(p.allocated_amount - bt.debit_amount) / nullif(bt.debit_amount, 0) * 100, 2) as amount_diff_pct
  from public.bank_transactions bt
  join public.supplier_bill_payments p on p.mode = 'rtgs_neft' and p.confirmed = false
  join public.supplier_bills b on b.id = p.bill_id and b.status <> 'void'
  left join public.suppliers s on s.id = b.supplier_id
  where bt.id = p_bank_transaction_id
    and bt.debit_amount > 0
    and p.allocated_amount > 0
    and least(p.allocated_amount, bt.debit_amount) / greatest(p.allocated_amount, bt.debit_amount) >= 0.95
  order by utr_matches desc, amount_diff_pct asc;
$$;

-- Matches every unmatched bank debit to its best pending RTGS/NEFT payment (95% or better) and
-- confirms it. Returns how many payments were matched.
create or replace function public.auto_match_bank_transactions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bt record;
  v_payment_id uuid;
  v_matched integer := 0;
begin
  if not public.has_permission('bank_reconciliation') then
    raise exception 'You do not have permission to reconcile bank transactions.';
  end if;

  for v_bt in
    select * from public.bank_transactions
    where matched = false and debit_amount > 0
    order by txn_date, created_at
    for update
  loop
    select p.id into v_payment_id
    from public.supplier_bill_payments p
    join public.supplier_bills b on b.id = p.bill_id and b.status <> 'void'
    where p.mode = 'rtgs_neft' and p.confirmed = false and p.allocated_amount > 0
      and least(p.allocated_amount, v_bt.debit_amount) / greatest(p.allocated_amount, v_bt.debit_amount) >= 0.95
    order by (p.utr_reference is not null and p.utr_reference = v_bt.utr_reference) desc,
             abs(p.allocated_amount - v_bt.debit_amount) asc,
             p.created_at asc
    limit 1
    for update of p;

    if v_payment_id is not null then
      update public.bank_transactions set matched = true, matched_payment_id = v_payment_id where id = v_bt.id;
      update public.supplier_bill_payments
        set confirmed = true, confirmed_amount = v_bt.debit_amount, confirmed_at = now(), bank_transaction_id = v_bt.id
        where id = v_payment_id;
      v_matched := v_matched + 1;
      v_payment_id := null;
    end if;
  end loop;

  return v_matched;
end;
$$;

revoke all on function public.auto_match_bank_transactions() from public, anon;
grant execute on function public.auto_match_bank_transactions() to authenticated;
