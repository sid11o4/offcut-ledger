-- Take back a wrong payment line on a bill that is still pending review. (Approved bills use
-- "Reverse payment", which keeps a record.) A line already matched to a bank statement entry stays.
create or replace function public.remove_bill_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pay public.supplier_bill_payments; v_status text;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to change bill payments.';
  end if;
  select * into v_pay from public.supplier_bill_payments where id = p_payment_id for update;
  if v_pay.id is null then raise exception 'Payment not found.'; end if;
  select status into v_status from public.supplier_bills where id = v_pay.bill_id;
  if v_status <> 'pending_review' then
    raise exception 'Only a bill still pending review can have a payment line removed. Use Reverse payment on an approved bill.';
  end if;
  if v_pay.bank_transaction_id is not null then
    raise exception 'This payment is matched to a bank statement entry and cannot be removed here.';
  end if;
  delete from public.supplier_bill_payments where id = p_payment_id;
end $$;
revoke all on function public.remove_bill_payment(uuid) from public, anon;
grant execute on function public.remove_bill_payment(uuid) to authenticated;
