-- Where a material's stock came from, for anyone who can operate inventory. Vendor bill details are read
-- through this function, so inventory users do not need the bill-read permission.
create or replace function public.material_sources(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to see where this material came from.';
  end if;
  return jsonb_build_object(
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'quantity', i.quantity, 'total_amount', i.total_amount,
        'supplier_bills', jsonb_build_object(
          'id', b.id, 'internal_bill_number', b.internal_bill_number, 'bill_date', b.bill_date,
          'status', b.status, 'bill_source', b.bill_source, 'supplier_text', b.supplier_text,
          'suppliers', jsonb_build_object('name', s.name))
      ) order by b.bill_date desc)
      from public.supplier_bill_items i
      join public.supplier_bills b on b.id = i.bill_id
      left join public.suppliers s on s.id = b.supplier_id
      where i.inventory_item_id = p_item_id
    ), '[]'::jsonb),
    'direct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'txn_date', t.txn_date, 'quantity', t.quantity, 'unit_cost', t.unit_cost, 'total_cost', t.total_cost,
        'inventory_locations', jsonb_build_object('name', l.name, 'kind', l.kind,
          'design_projects', jsonb_build_object('name', dp.name)))
      order by t.txn_date desc)
      from public.inventory_transactions t
      join public.inventory_locations l on l.id = t.location_id
      left join public.design_projects dp on dp.id = l.design_project_id
      where t.item_id = p_item_id and t.txn_type = 'purchase' and t.reference_type = 'adjustment' and t.reversed_by is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.material_sources(uuid) from public, anon;
grant execute on function public.material_sources(uuid) to authenticated;
