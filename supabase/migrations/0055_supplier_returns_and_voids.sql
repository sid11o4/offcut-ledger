-- Supplier returns and voids, completed.
--
-- Returns: a return is processed straight away (the stock leaves at its average cost and the slip total
-- is owed back by the supplier). The slip itself is owed to the books afterwards, so each slip carries a
-- follow-up status: pending_slip until the signed slip is filed with its reference and date.
--
-- Voids: an approved supplier bill can be voided. Its purchases are reversed out of stock at the cost they
-- came in at, and the bill is marked void. A bill with payments recorded must have them reversed first, so
-- money is never left against a voided bill.

alter table public.supplier_return_slips
  add column if not exists follow_up_status text not null default 'pending_slip'
    check (follow_up_status in ('pending_slip', 'filed')),
  add column if not exists slip_filed_reference text,
  add column if not exists slip_filed_on date,
  add column if not exists slip_filed_by uuid references public.profiles(id);

create index if not exists idx_return_slips_follow_up on public.supplier_return_slips(follow_up_status);

create or replace function public.file_return_slip(p_slip_id uuid, p_reference text, p_filed_on date)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to file return slips.';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'Enter the reference of the signed slip.';
  end if;
  update public.supplier_return_slips
    set follow_up_status = 'filed',
        slip_filed_reference = btrim(p_reference),
        slip_filed_on = coalesce(p_filed_on, current_date),
        slip_filed_by = auth.uid()
    where id = p_slip_id and follow_up_status = 'pending_slip';
  if not found then
    raise exception 'That slip is not waiting to be filed.';
  end if;
end;
$$;

create or replace function public.void_supplier_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_bill record;
  v_payments int;
  r record;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to void supplier bills.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the bill is being voided.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'approved' then
    raise exception 'Only an approved bill is voided. Unapproved bills can be deleted instead.';
  end if;

  select count(*) into v_payments from public.supplier_bill_payments where bill_id = p_bill_id;
  if v_payments > 0 then
    raise exception 'This bill has payments recorded. Reverse them before voiding it.';
  end if;

  -- Takes back the stock this bill brought in, at the cost it came in at.
  for r in
    select item_id, location_id, quantity, unit_cost
    from public.inventory_transactions
    where reference_type = 'supplier_bill' and reference_id = p_bill_id and txn_type = 'purchase'
  loop
    perform public.record_inventory_transaction(
      'adjustment', r.item_id, r.location_id, -r.quantity, null, current_date,
      'supplier_bill', p_bill_id, 'Reversed: bill voided - ' || btrim(p_reason)
    );
  end loop;

  update public.supplier_bills
    set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
    where id = p_bill_id;
end;
$$;

revoke execute on function public.file_return_slip(uuid, text, date) from public, anon;
revoke execute on function public.void_supplier_bill(uuid, text) from public, anon;
grant execute on function public.file_return_slip(uuid, text, date) to authenticated;
grant execute on function public.void_supplier_bill(uuid, text) to authenticated;
