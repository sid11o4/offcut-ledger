-- Deleting a vendor. A vendor with bills (other than voided ones) or return slips keeps its history, so
-- it is not deleted; the caller is told, and can deactivate it instead. A vendor with nothing, or only
-- voided bills, is removed: the voided bills keep the vendor's name as written.
create or replace function public.delete_supplier(p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_bills int;
  v_returns int;
begin
  if not (public.has_permission('design_build_manage') or public.has_permission('supplier_bills_manage')) then
    raise exception 'You do not have permission to delete a vendor.';
  end if;
  select name into v_name from public.suppliers where id = p_supplier_id;
  if v_name is null then raise exception 'Vendor not found.'; end if;

  select count(*) into v_bills from public.supplier_bills where supplier_id = p_supplier_id and status <> 'void';
  select count(*) into v_returns from public.supplier_return_slips where supplier_id = p_supplier_id;
  if v_bills > 0 or v_returns > 0 then
    return jsonb_build_object('result', 'in_use', 'bills', v_bills, 'returns', v_returns, 'name', v_name);
  end if;

  update public.supplier_bills set supplier_id = null, supplier_text = coalesce(supplier_text, v_name)
    where supplier_id = p_supplier_id;
  delete from public.suppliers where id = p_supplier_id;
  return jsonb_build_object('result', 'deleted', 'name', v_name);
end;
$$;
revoke all on function public.delete_supplier(uuid) from public, anon;
grant execute on function public.delete_supplier(uuid) to authenticated;
