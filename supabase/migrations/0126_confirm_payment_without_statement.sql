-- Confirm a pending RTGS / NEFT payment by hand, without a bank statement line matching it. The reason is kept on the payment.
create or replace function public.confirm_payment_without_statement(p_payment_id uuid, p_reason text)
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
        remarks = coalesce(remarks || ' · ', '') || 'Confirmed without bank statement: ' || btrim(p_reason)
    where id = p_payment_id;
end;
$$;
revoke execute on function public.confirm_payment_without_statement(uuid, text) from public, anon;
grant execute on function public.confirm_payment_without_statement(uuid, text) to authenticated;
