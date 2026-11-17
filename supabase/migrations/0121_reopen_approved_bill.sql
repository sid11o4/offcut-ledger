-- Edit an approved bill: reopen it for review, correct it, approve it again.
-- A vendor bill's stock is taken back out (as in a void); approving again posts the corrected lines.
-- A vendor bill with a payment already made, or a FORMGRID bill with lines that pay vendor credit, is not reopened:
-- reverse those first.
create or replace function public.reopen_supplier_bill(p_bill_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_bill record;
  r record;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to edit supplier bills.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the bill is being reopened.'; end if;
  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'approved' then raise exception 'Only an approved bill can be reopened.'; end if;

  if v_bill.bill_source = 'vendor' then
    if exists (select 1 from public.supplier_bill_payments where bill_id = p_bill_id and mode <> 'credit') then
      raise exception 'This bill has payments recorded. Reverse them before editing it.';
    end if;
    for r in
      select item_id, location_id, quantity from public.inventory_transactions
      where reference_type = 'supplier_bill' and reference_id = p_bill_id and txn_type = 'purchase'
    loop
      perform public.record_inventory_transaction('adjustment', r.item_id, r.location_id, -r.quantity, null, current_date,
        'supplier_bill', p_bill_id, 'Reversed: bill reopened for editing - ' || btrim(p_reason));
    end loop;
    -- The payable is rebuilt from the corrected total when the bill is approved again.
    delete from public.supplier_bill_payments where bill_id = p_bill_id and mode = 'credit';
  else
    if exists (select 1 from public.supplier_bill_items where bill_id = p_bill_id and pays_vendor_credit) then
      raise exception 'This bill pays vendor credit. Reverse that before editing it.';
    end if;
  end if;

  update public.supplier_bills set status = 'pending_review', approved_by = null, approved_at = null where id = p_bill_id;
end;
$$;
revoke execute on function public.reopen_supplier_bill(uuid, text) from public, anon;
grant execute on function public.reopen_supplier_bill(uuid, text) to authenticated;

-- Approving a vendor bill that has no payable row (after a reopen) records its total as owed to the vendor.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'approve_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('perform public.post_unlinked_bill_lines(p_bill_id);' in d) = 0 then raise exception 'approve marker missing'; end if;
  d := replace(d, 'perform public.post_unlinked_bill_lines(p_bill_id);',
    E'perform public.post_unlinked_bill_lines(p_bill_id);\n    if not exists (select 1 from public.supplier_bill_payments where bill_id = p_bill_id) then\n      insert into public.supplier_bill_payments (bill_id, mode, allocated_amount, created_by)\n        select id, ''credit'', grand_total, auth.uid() from public.supplier_bills where id = p_bill_id and grand_total > 0;\n    end if;');
  execute d;
end $$;
