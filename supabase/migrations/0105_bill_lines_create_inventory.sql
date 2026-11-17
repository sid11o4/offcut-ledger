-- A vendor bill's material lines that were not linked to an inventory item used to be approved without
-- adding any stock. They now create the material (named as on the bill, in the category of the line's
-- cost head) and post the purchase into the bill's project inventory, or the company's when the bill has
-- no project. Transport and miscellaneous lines are charges, not stock, and are left alone.
create or replace function public.post_unlinked_bill_lines(p_bill_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill record;
  v_line record;
  v_location uuid;
  v_unit text;
  v_cat text;
  v_item uuid;
  v_count integer := 0;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to post supplier bill stock.';
  end if;
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.bill_source <> 'vendor' then return 0; end if;

  if v_bill.design_project_id is not null then
    select id into v_location from public.inventory_locations where kind = 'project' and design_project_id = v_bill.design_project_id;
  else
    select id into v_location from public.inventory_locations where kind = 'company';
  end if;

  for v_line in
    select * from public.supplier_bill_items
    where bill_id = p_bill_id and item_type = 'material' and inventory_item_id is null
      and coalesce(cost_head, 'other') not in ('transport', 'miscellaneous')
    order by sort_order
  loop
    v_cat := case v_line.cost_head
      when 'raw_boards' then 'Raw Boards' when 'skins' then 'Skins' when 'edgeband' then 'Edgeband'
      when 'hardware' then 'Hardware' else 'Others' end;
    select u.code into v_unit from public.units u
      where u.active and u.inventory_unit
        and (upper(u.code) = upper(btrim(coalesce(v_line.unit_text, ''))) or upper(u.name) = upper(btrim(coalesce(v_line.unit_text, ''))))
      limit 1;
    v_item := public.ensure_inventory_item(v_line.description, coalesce(v_unit, 'NOS'), v_cat);
    update public.supplier_bill_items set inventory_item_id = v_item where id = v_line.id;
    perform public.record_inventory_purchase(
      v_item, v_location, v_line.quantity, v_line.total_amount / v_line.quantity, v_bill.bill_date,
      'supplier_bill', p_bill_id, 'Supplier bill ' || v_bill.internal_bill_number);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.post_unlinked_bill_lines(uuid) from public, anon;
grant execute on function public.post_unlinked_bill_lines(uuid) to authenticated;

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

    -- Material lines that were never linked still become stock.
    perform public.post_unlinked_bill_lines(p_bill_id);
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
