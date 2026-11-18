-- 1. Voiding a vendor bill is only blocked by real payments (cash, RTGS / NEFT, waiver), not by its payable (credit) entry,
--    which goes with the bill. Stock the bill brought in is taken back out; anything already returned or used goes short
--    until the replacement bill is entered.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'void_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('select count(*) into v_payments from public.supplier_bill_payments where bill_id = p_bill_id;' in d) = 0 then raise exception 'void marker missing'; end if;
  d := replace(d, 'select count(*) into v_payments from public.supplier_bill_payments where bill_id = p_bill_id;',
    E'select count(*) into v_payments from public.supplier_bill_payments where bill_id = p_bill_id and mode <> ''credit'';\n  delete from public.supplier_bill_payments where bill_id = p_bill_id and mode = ''credit'';');
  execute d;
end $$;

-- 2. Reverse a payment: the record is kept in supplier_payment_reversals, the payment is removed so the amount is owed again,
--    and a matched bank statement line is freed.
create table if not exists public.supplier_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  bill_id uuid not null,
  mode text not null,
  amount numeric not null,
  utr_reference text,
  reason text not null,
  payment_snapshot jsonb not null,
  reversed_by uuid default auth.uid(),
  reversed_at timestamptz not null default now()
);
alter table public.supplier_payment_reversals enable row level security;
drop policy if exists supplier_payment_reversals_read on public.supplier_payment_reversals;
create policy supplier_payment_reversals_read on public.supplier_payment_reversals for select to authenticated
  using (public.has_permission('supplier_bills_manage') or public.has_permission('bank_reconciliation'));

create or replace function public.reverse_supplier_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_pay public.supplier_bill_payments;
begin
  if not (public.has_permission('supplier_bills_manage') or public.has_permission('bank_reconciliation')) then
    raise exception 'You do not have permission to reverse payments.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the payment is being reversed.'; end if;
  select * into v_pay from public.supplier_bill_payments where id = p_payment_id for update;
  if v_pay.id is null then raise exception 'Payment not found.'; end if;
  if v_pay.mode = 'credit' then raise exception 'That is the amount owed on the bill, not a payment.'; end if;
  if v_pay.bank_transaction_id is not null then
    update public.bank_transactions set matched = false, matched_payment_id = null where id = v_pay.bank_transaction_id;
  end if;
  insert into public.supplier_payment_reversals (payment_id, bill_id, mode, amount, utr_reference, reason, payment_snapshot)
    values (v_pay.id, v_pay.bill_id, v_pay.mode, v_pay.allocated_amount, v_pay.utr_reference, btrim(p_reason), to_jsonb(v_pay));
  delete from public.supplier_bill_payments where id = p_payment_id;
end;
$$;
revoke execute on function public.reverse_supplier_payment(uuid, text) from public, anon;
grant execute on function public.reverse_supplier_payment(uuid, text) to authenticated;
