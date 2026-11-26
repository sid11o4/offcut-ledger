-- Editing an approved vendor bill no longer stops at "reverse its payments first": reopening it
-- reverses them itself, with the same record "Reverse payment" keeps (supplier_payment_reversals) and
-- any bank statement line they were matched to becomes unmatched again. Payments are then entered again
-- when the corrected bill is approved.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.reopen_supplier_bill(uuid, text)'::regprocedure);
  if position('  r record;' || chr(10) || 'begin' in d) = 0 then raise exception 'marker 1 missing'; end if;
  d := replace(d, '  r record;' || chr(10) || 'begin', '  r record;' || chr(10) || '  v_pay public.supplier_bill_payments;' || chr(10) || 'begin');
  if position('This bill has payments recorded. Reverse them before editing it.' in d) = 0 then raise exception 'marker 2 missing'; end if;
  d := replace(d,
$old$    if exists (select 1 from public.supplier_bill_payments where bill_id = p_bill_id and mode <> 'credit') then
      raise exception 'This bill has payments recorded. Reverse them before editing it.';
    end if;$old$,
$new$    for v_pay in select * from public.supplier_bill_payments where bill_id = p_bill_id and mode <> 'credit' order by created_at, id loop
      if v_pay.bank_transaction_id is not null then
        update public.bank_transactions set matched = false, matched_payment_id = null where id = v_pay.bank_transaction_id;
      end if;
      insert into public.supplier_payment_reversals (payment_id, bill_id, mode, amount, utr_reference, reason, payment_snapshot)
        values (v_pay.id, v_pay.bill_id, v_pay.mode, v_pay.allocated_amount, v_pay.utr_reference,
                'Bill reopened for editing - ' || btrim(p_reason), to_jsonb(v_pay));
      delete from public.supplier_bill_payments where id = v_pay.id;
    end loop;$new$);
  if d not like '%Bill reopened for editing - %' then raise exception 'replace did not apply'; end if;
  execute d;
end $$;
