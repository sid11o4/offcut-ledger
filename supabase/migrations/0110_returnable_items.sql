-- The items that can be returned to a supplier from a location: only those still in stock there that came
-- from that supplier's bills (directly, or by transfer, since a lot keeps its vendor bill).
create or replace function public.returnable_items(p_supplier_id uuid, p_location_id uuid)
returns table(item_id uuid, quantity numeric)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to return stock to a supplier.';
  end if;
  return query
  select l.item_id, sum(l.remaining)
  from public.inventory_lots l
  join public.supplier_bills b on b.id = l.vendor_bill_id
  where b.supplier_id = p_supplier_id and l.location_id = p_location_id and l.remaining > 0 and b.status <> 'void'
  group by l.item_id
  having sum(l.remaining) > 0;
end;
$function$;
revoke all on function public.returnable_items(uuid, uuid) from public, anon;
grant execute on function public.returnable_items(uuid, uuid) to authenticated;
