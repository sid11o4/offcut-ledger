-- A direct vendor payment may exceed what the vendor is owed. It clears their open bills, oldest
-- first, and the rest is held as an advance (applied to their next approved bill).
--
-- vendor_gross_open is what the vendor is owed WITHOUT the return credits taken off, i.e. the bills
-- less the payments already made. The app warns only when a payment is above that figure.
create or replace function public.vendor_gross_open(p_supplier_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(
    b.grand_total - coalesce((select sum(p.allocated_amount) from public.supplier_bill_payments p
                              where p.bill_id = b.id and p.mode in ('cash', 'rtgs_neft', 'waiver')), 0), 0)), 0)
  from public.supplier_bills b
  where b.supplier_id = p_supplier_id and b.bill_source = 'vendor' and b.status = 'approved';
$$;
revoke all on function public.vendor_gross_open(uuid) from public, anon;
grant execute on function public.vendor_gross_open(uuid) to authenticated;

create or replace function public.record_vendor_payment(p_supplier_id uuid, p_mode text, p_amount numeric, p_utr text, p_remarks text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric := p_amount;
  v_take numeric;
  v_open numeric;
  v_bill record;
  v_n integer := 0;
  v_utr text := nullif(btrim(coalesce(p_utr, '')), '');
  v_rem text := 'Direct payment' || coalesce(' · ' || nullif(btrim(coalesce(p_remarks, '')), ''), '');
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if p_mode not in ('cash', 'rtgs_neft') then raise exception 'A payment is cash or RTGS / NEFT.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.'; end if;
  if p_supplier_id is null then raise exception 'Choose the vendor paid.'; end if;

  for v_bill in
    select b.id from public.supplier_bills b
    where b.supplier_id = p_supplier_id and b.bill_source = 'vendor' and b.status = 'approved'
      and not (b.purpose = 'vendor_credit' and b.internal_bill_number like 'ADV-%')
    order by b.bill_date, b.created_at
  loop
    exit when v_left <= 0.004;
    v_open := public.vendor_bill_open_amount(v_bill.id);
    continue when v_open <= 0.004;
    v_take := least(v_left, v_open);
    insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, utr_reference, remarks, created_by)
      values (v_bill.id, p_mode, round(v_take, 2), v_utr, v_rem, auth.uid());
    v_left := v_left - v_take;
    v_n := v_n + 1;
  end loop;

  -- Whatever the open bills could not absorb is an advance to the vendor.
  if v_left > 0.004 then
    insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, utr_reference, remarks, created_by)
      values (public.vendor_advance_bill(p_supplier_id), p_mode, round(v_left, 2), v_utr, 'Advance · ' || v_rem, auth.uid());
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;
revoke execute on function public.record_vendor_payment(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.record_vendor_payment(uuid, text, numeric, text, text) to authenticated;
