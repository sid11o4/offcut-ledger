-- Record a payment to a vendor directly, without a FORMGRID bill. It is applied to the vendor's outstanding
-- approved bills, oldest first, the same way a FORMGRID bill that pays vendor credit is.
create or replace function public.vendor_bill_open_amount(p_bill_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select b.grand_total
    - coalesce((select sum(p.allocated_amount) from public.supplier_bill_payments p where p.bill_id = b.id and p.mode in ('cash', 'rtgs_neft', 'waiver')), 0)
    - coalesce((select sum(coalesce(r.credit_amount, r.total_amount)) from public.supplier_return_slips r where r.adjusted_bill_id = b.id and r.credit_status = 'settled'), 0)
  from public.supplier_bills b where b.id = p_bill_id;
$$;

create or replace function public.vendor_open_balance(p_supplier_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(public.vendor_bill_open_amount(b.id), 0)), 0)
  from public.supplier_bills b
  where b.supplier_id = p_supplier_id and b.bill_source = 'vendor' and b.status = 'approved';
$$;

create or replace function public.record_vendor_payment(p_supplier_id uuid, p_mode text, p_amount numeric, p_utr text, p_remarks text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric := p_amount;
  v_take numeric;
  v_open numeric;
  v_bill record;
  v_n integer := 0;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if p_mode not in ('cash', 'rtgs_neft') then raise exception 'A payment is cash or RTGS / NEFT.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.'; end if;
  if p_supplier_id is null then raise exception 'Choose the vendor paid.'; end if;
  if public.vendor_open_balance(p_supplier_id) + 0.5 < p_amount then
    raise exception 'This vendor is owed Rs % in outstanding bills, less than the payment.', round(public.vendor_open_balance(p_supplier_id), 2);
  end if;

  for v_bill in
    select b.id from public.supplier_bills b
    where b.supplier_id = p_supplier_id and b.bill_source = 'vendor' and b.status = 'approved'
    order by b.bill_date, b.created_at
  loop
    exit when v_left <= 0.004;
    v_open := public.vendor_bill_open_amount(v_bill.id);
    continue when v_open <= 0.004;
    v_take := least(v_left, v_open);
    insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, utr_reference, remarks, created_by)
      values (v_bill.id, p_mode, round(v_take, 2), nullif(btrim(coalesce(p_utr, '')), ''),
              'Direct payment' || coalesce(' · ' || nullif(btrim(coalesce(p_remarks, '')), ''), ''), auth.uid());
    v_left := v_left - v_take;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.record_vendor_payment(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.record_vendor_payment(uuid, text, numeric, text, text) to authenticated;
revoke execute on function public.vendor_open_balance(uuid) from public, anon;
grant execute on function public.vendor_open_balance(uuid) to authenticated;
