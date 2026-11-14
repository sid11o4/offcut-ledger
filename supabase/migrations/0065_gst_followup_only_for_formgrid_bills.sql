-- GST separation is not done for vendor bills. Approving a vendor bill posts its material and marks it
-- approved; the GST follow-up is only raised for FORMGRID bills.
create or replace function public.approve_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill record;
  v_item record;
  v_location_id uuid;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to approve supplier bills.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'pending_review' then
    raise exception 'Only a bill pending review can be approved.';
  end if;
  if v_bill.supplier_id is null then
    raise exception 'Match this bill to a supplier before approving it.';
  end if;

  if v_bill.bill_source = 'vendor' then
    if v_bill.design_project_id is not null then
      select id into v_location_id from public.inventory_locations
        where kind = 'project' and design_project_id = v_bill.design_project_id;
    else
      select id into v_location_id from public.inventory_locations where kind = 'company';
    end if;

    for v_item in
      select * from public.supplier_bill_items
      where bill_id = p_bill_id and item_type = 'material' and inventory_item_id is not null
    loop
      if (select track_as_inventory from public.inventory_items where id = v_item.inventory_item_id) then
        perform public.record_inventory_purchase(
          v_item.inventory_item_id, v_location_id, v_item.quantity,
          v_item.total_amount / v_item.quantity, v_bill.bill_date,
          'supplier_bill', p_bill_id, 'Supplier bill ' || v_bill.internal_bill_number);
      end if;
    end loop;
  end if;

  update public.supplier_bills
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_bill_id;

  if v_bill.bill_source = 'formgrid' then
    perform public.ensure_gst_followup(p_bill_id);
  end if;
end;
$function$;

revoke all on function public.approve_supplier_bill(uuid) from public, anon;
grant execute on function public.approve_supplier_bill(uuid) to authenticated;
