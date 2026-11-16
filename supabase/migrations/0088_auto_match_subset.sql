-- The amount-based (95%) matcher can now be limited to a given set of bank lines, so the AI name
-- matcher can hand over only the lines whose payee it could not identify.

drop function if exists public.auto_match_bank_transactions();

create or replace function public.auto_match_bank_transactions(p_ids uuid[] default null)
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
      and (p_ids is null or id = any(p_ids))
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

revoke all on function public.auto_match_bank_transactions(uuid[]) from public, anon;
grant execute on function public.auto_match_bank_transactions(uuid[]) to authenticated;
