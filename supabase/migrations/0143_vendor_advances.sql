-- A FORMGRID bill line that "pays vendor credit" offsets the vendor's open bills; whatever is left
-- over is no longer an error: it is held as an ADVANCE to the vendor/contractor and is applied to
-- their next approved bill automatically.
--
-- The advance is kept as payment rows (cash / RTGS-NEFT, with UTR and bank matching intact) on one
-- placeholder vendor bill per supplier ("ADV-xxxxxxxx", total 0). That bill has no lines and no
-- project, so it is never a cost; its payments make it "overpaid", and that overpayment is the
-- advance balance.

create or replace function public.vendor_advance_bill(p_supplier uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  select id into v_id from public.supplier_bills
    where supplier_id = p_supplier and bill_source = 'vendor' and purpose = 'vendor_credit'
      and internal_bill_number like 'ADV-%' limit 1;
  if v_id is not null then return v_id; end if;
  select name into v_name from public.suppliers where id = p_supplier;
  insert into public.supplier_bills (internal_bill_number, bill_date, supplier_id, supplier_text, expense_nature, bill_source,
      purpose, status, remarks, grand_total, approved_at)
    values ('ADV-' || substr(p_supplier::text, 1, 8), current_date, p_supplier, v_name, 'material', 'vendor',
      'vendor_credit', 'approved', 'Advance paid to the vendor. Applied to their next bills automatically.', 0, now())
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.vendor_advance_balance(p_supplier uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.allocated_amount), 0)
  from public.supplier_bills b join public.supplier_bill_payments p on p.bill_id = b.id
  where b.supplier_id = p_supplier and b.bill_source = 'vendor' and b.purpose = 'vendor_credit'
    and b.internal_bill_number like 'ADV-%' and p.mode in ('cash', 'rtgs_neft');
$$;

-- Applies the vendor's held advance to an approved vendor bill, oldest advance first.
create or replace function public.apply_vendor_advances(p_bill_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_bill public.supplier_bills; v_adv uuid; v_pay public.supplier_bill_payments;
  v_open numeric; v_take numeric; v_used numeric := 0;
begin
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.id is null or v_bill.bill_source <> 'vendor' or v_bill.supplier_id is null then return 0; end if;
  if v_bill.purpose = 'vendor_credit' and v_bill.internal_bill_number like 'ADV-%' then return 0; end if;
  select id into v_adv from public.supplier_bills
    where supplier_id = v_bill.supplier_id and bill_source = 'vendor' and purpose = 'vendor_credit' and internal_bill_number like 'ADV-%' limit 1;
  if v_adv is null then return 0; end if;

  for v_pay in select * from public.supplier_bill_payments where bill_id = v_adv and mode in ('cash', 'rtgs_neft') order by created_at, id loop
    v_open := public.vendor_bill_open_amount(p_bill_id);
    exit when v_open <= 0.004;
    v_take := least(v_pay.allocated_amount, v_open);
    if v_take >= v_pay.allocated_amount - 0.004 then
      update public.supplier_bill_payments set bill_id = p_bill_id,
        remarks = coalesce(v_pay.remarks || ' · ', '') || 'Advance applied to bill ' || v_bill.internal_bill_number where id = v_pay.id;
    else
      -- a payment matched to a bank statement line cannot be divided; leave it for a bill it fits
      continue when v_pay.mode = 'rtgs_neft' and v_pay.confirmed;
      insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, remarks, utr_reference, confirmed, confirmed_amount, confirmed_at, received_by, created_by)
        values (p_bill_id, v_pay.mode, v_take, coalesce(v_pay.remarks || ' · ', '') || 'Advance applied to bill ' || v_bill.internal_bill_number, v_pay.utr_reference,
                v_pay.confirmed, case when v_pay.confirmed then v_take end, v_pay.confirmed_at, v_pay.received_by, v_pay.created_by);
      update public.supplier_bill_payments
        set allocated_amount = allocated_amount - v_take,
            confirmed_amount = case when confirmed_amount is not null then confirmed_amount - v_take end
        where id = v_pay.id;
    end if;
    v_used := v_used + v_take;
  end loop;
  return v_used;
end $$;

revoke all on function public.vendor_advance_bill(uuid), public.apply_vendor_advances(uuid) from public, anon, authenticated;
revoke all on function public.vendor_advance_balance(uuid) from public, anon;
grant execute on function public.vendor_advance_balance(uuid) to authenticated;

-- 1) Credit lines: whatever the vendor's open bills cannot absorb becomes an advance.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.apply_formgrid_payments_to_vendor_credit(uuid, numeric)'::regprocedure);
  if position('  v_open numeric;' || chr(10) || 'begin' in d) = 0 then raise exception 'marker 1 missing'; end if;
  d := replace(d, '  v_open numeric;' || chr(10) || 'begin', '  v_open numeric;' || chr(10) || '  v_adv uuid;' || chr(10) || 'begin');
  if position('    if v_left > 0.5 then' in d) = 0 then raise exception 'marker 2 missing'; end if;
  d := replace(d,
$old$    if v_left > 0.5 then
      raise exception 'This vendor''s outstanding bills are Rs % less than the credit this bill pays.', round(v_left, 2);
    end if;$old$,
$new$    if v_left > 0.004 then
      -- nothing left to offset: hold the rest as an advance to the vendor
      v_adv := public.vendor_advance_bill(v_bill.supplier_id);
      if v_left >= v_pay.allocated_amount - 0.004 then
        update public.supplier_bill_payments set bill_id = v_adv, remarks = coalesce(v_pay.remarks || ' · ', '') || 'Advance paid through FORMGRID bill ' || v_bill.internal_bill_number where id = v_pay.id;
      else
        if v_pay.mode = 'rtgs_neft' and v_pay.confirmed then
          raise exception 'An RTGS / NEFT payment already matched to the bank cannot be split. Record it as a separate payment.';
        end if;
        insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, remarks, utr_reference, confirmed, confirmed_amount, confirmed_at, received_by, created_by)
          values (v_adv, v_pay.mode, v_left, 'Advance paid through FORMGRID bill ' || v_bill.internal_bill_number, v_pay.utr_reference,
                  v_pay.confirmed, case when v_pay.confirmed then v_left end, v_pay.confirmed_at, v_pay.received_by, v_pay.created_by);
        update public.supplier_bill_payments
          set allocated_amount = allocated_amount - v_left,
              confirmed_amount = case when confirmed_amount is not null then confirmed_amount - v_left end
          where id = v_pay.id;
      end if;
    end if;$new$);
  if d not like '%vendor_advance_bill%' then raise exception 'replace 2 did not apply'; end if;
  execute d;

  -- 2) A newly approved vendor bill takes the vendor's advance.
  d := pg_get_functiondef('public.approve_supplier_bill(uuid)'::regprocedure);
  if position('where id = p_bill_id and grand_total > 0;' || chr(10) || '    end if;' in d) = 0 then raise exception 'marker 3 missing'; end if;
  d := replace(d, 'where id = p_bill_id and grand_total > 0;' || chr(10) || '    end if;',
    'where id = p_bill_id and grand_total > 0;' || chr(10) || '    end if;' || chr(10) || '    perform public.apply_vendor_advances(p_bill_id);');
  execute d;
end $$;
