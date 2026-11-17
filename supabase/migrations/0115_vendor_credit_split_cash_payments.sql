-- Cash can be divided between vendor bills (it has no bank line to keep intact); only an RTGS / NEFT payment
-- already matched to a bank statement line cannot be split. A split carries the confirmation of the cash.
-- (Replaces apply_formgrid_payments_to_vendor_credit from 0114; applied to the database as a function update.)

create or replace function public.apply_formgrid_payments_to_vendor_credit(p_bill_id uuid, p_credit numeric)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
  v_pay public.supplier_bill_payments;
  v_v record;
  v_rem numeric := p_credit;
  v_left numeric;
  v_take numeric;
  v_open numeric;
begin
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.supplier_id is null then raise exception 'Match this bill to the vendor whose credit it pays.'; end if;

  for v_pay in select * from public.supplier_bill_payments where bill_id = p_bill_id and mode in ('cash', 'rtgs_neft') order by created_at, id loop
    exit when v_rem <= 0.004;
    v_left := least(v_pay.allocated_amount, v_rem);
    v_rem := v_rem - v_left;
    for v_v in
      select b.id, b.grand_total from public.supplier_bills b
      where b.supplier_id = v_bill.supplier_id and b.bill_source = 'vendor' and b.status = 'approved'
      order by b.bill_date, b.created_at
    loop
      exit when v_left <= 0.004;
      select v_v.grand_total
        - coalesce((select sum(p.allocated_amount) from public.supplier_bill_payments p where p.bill_id = v_v.id and p.mode in ('cash', 'rtgs_neft', 'waiver')), 0)
        - coalesce((select sum(coalesce(r.credit_amount, r.total_amount)) from public.supplier_return_slips r where r.adjusted_bill_id = v_v.id and r.credit_status = 'settled'), 0)
        into v_open;
      continue when v_open <= 0.004;
      v_take := least(v_left, v_open);
      if v_take >= v_pay.allocated_amount - 0.004 then
        update public.supplier_bill_payments set bill_id = v_v.id, remarks = coalesce(v_pay.remarks || ' · ', '') || 'Paid through FORMGRID bill ' || v_bill.internal_bill_number where id = v_pay.id;
      else
        if v_pay.mode = 'rtgs_neft' and v_pay.confirmed then
          raise exception 'An RTGS / NEFT payment already matched to the bank cannot be split. Record it as a separate payment.';
        end if;
        insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, remarks, utr_reference, confirmed, confirmed_amount, confirmed_at, received_by, created_by)
          values (v_v.id, v_pay.mode, v_take, 'Paid through FORMGRID bill ' || v_bill.internal_bill_number, v_pay.utr_reference,
                  v_pay.confirmed, case when v_pay.confirmed then v_take end, v_pay.confirmed_at, v_pay.received_by, v_pay.created_by);
        update public.supplier_bill_payments
          set allocated_amount = allocated_amount - v_take,
              confirmed_amount = case when confirmed_amount is not null then confirmed_amount - v_take end
          where id = v_pay.id;
        v_pay.allocated_amount := v_pay.allocated_amount - v_take;
      end if;
      v_left := v_left - v_take;
    end loop;
    if v_left > 0.5 then
      raise exception 'This vendor''s outstanding bills are Rs % less than the credit this bill pays.', round(v_left, 2);
    end if;
  end loop;
  if v_rem > 0.5 then
    raise exception 'Pay at least Rs % more in cash or RTGS / NEFT: the lines that pay vendor credit must be paid.', round(v_rem, 2);
  end if;
  delete from public.supplier_bill_payments where bill_id = p_bill_id and allocated_amount <= 0.004;
end;
$function$;
revoke all on function public.apply_formgrid_payments_to_vendor_credit(uuid, numeric) from public, anon, authenticated;
