-- A payment confirmed by hand can carry a UTR, and a statement uploaded later is linked to it by that UTR.
drop function if exists public.confirm_payment_without_statement(uuid, text);
create or replace function public.confirm_payment_without_statement(p_payment_id uuid, p_reason text, p_utr text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_payment record;
begin
  if not public.has_permission('bank_reconciliation') then
    raise exception 'You do not have permission to confirm payments.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why it is confirmed without a bank statement.'; end if;
  select * into v_payment from public.supplier_bill_payments where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'Payment not found.'; end if;
  if v_payment.confirmed then raise exception 'This payment is already confirmed.'; end if;
  if v_payment.mode <> 'rtgs_neft' then raise exception 'Only an RTGS / NEFT payment is confirmed this way.'; end if;
  update public.supplier_bill_payments
    set confirmed = true, confirmed_amount = allocated_amount, confirmed_at = now(), bank_transaction_id = null,
        utr_reference = coalesce(nullif(btrim(coalesce(p_utr, '')), ''), utr_reference),
        remarks = coalesce(remarks || ' · ', '') || 'Confirmed without bank statement: ' || btrim(p_reason)
    where id = p_payment_id;
  perform public.link_statement_to_confirmed_payments();
end;
$$;
revoke execute on function public.confirm_payment_without_statement(uuid, text, text) from public, anon;
grant execute on function public.confirm_payment_without_statement(uuid, text, text) to authenticated;

-- Links unmatched bank debits to payments already confirmed by hand, when the UTR is the same. Returns how many.
create or replace function public.link_statement_to_confirmed_payments()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_bt record; v_n integer := 0;
begin
  if not (public.has_permission('bank_reconciliation') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to reconcile bank transactions.';
  end if;
  for r in
    select id, utr_reference from public.supplier_bill_payments
    where mode = 'rtgs_neft' and confirmed and bank_transaction_id is null and nullif(btrim(coalesce(utr_reference, '')), '') is not null
  loop
    select * into v_bt from public.bank_transactions
      where not matched and debit_amount > 0 and upper(btrim(coalesce(utr_reference, ''))) = upper(btrim(r.utr_reference))
      order by txn_date limit 1 for update;
    continue when v_bt.id is null;
    update public.bank_transactions set matched = true, matched_payment_id = r.id where id = v_bt.id;
    update public.supplier_bill_payments
      set bank_transaction_id = v_bt.id, confirmed_amount = v_bt.debit_amount,
          remarks = coalesce(remarks || ' · ', '') || 'Bank statement matched by UTR'
      where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.link_statement_to_confirmed_payments() from public, anon;
grant execute on function public.link_statement_to_confirmed_payments() to authenticated;

-- Enter or correct the UTR of an RTGS / NEFT payment, then link any statement line that carries it.
create or replace function public.set_payment_utr(p_payment_id uuid, p_utr text)
returns void language plpgsql security definer set search_path = public as $$
declare v_payment record;
begin
  if not (public.has_permission('bank_reconciliation') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to edit payments.';
  end if;
  select * into v_payment from public.supplier_bill_payments where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'Payment not found.'; end if;
  if v_payment.mode <> 'rtgs_neft' then raise exception 'Only an RTGS / NEFT payment has a UTR.'; end if;
  if v_payment.bank_transaction_id is not null then raise exception 'This payment is already matched to a bank statement line.'; end if;
  update public.supplier_bill_payments set utr_reference = nullif(btrim(coalesce(p_utr, '')), '') where id = p_payment_id;
  perform public.link_statement_to_confirmed_payments();
end;
$$;
revoke execute on function public.set_payment_utr(uuid, text) from public, anon;
grant execute on function public.set_payment_utr(uuid, text) to authenticated;
