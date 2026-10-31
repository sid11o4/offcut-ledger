-- Hard delete of a supplier bill that has NOT been approved. Approved bills have already
-- posted stock and expenses and must be reversed, not deleted.
create or replace function public.delete_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to delete supplier bills.';
  end if;

  select status into v_status from public.supplier_bills where id = p_bill_id for update;
  if v_status is null then
    raise exception 'Bill not found.';
  end if;
  if v_status = 'approved' then
    raise exception 'An approved bill has already posted to stock and expenses and cannot be deleted.';
  end if;

  delete from public.supplier_bills where id = p_bill_id;
end;
$$;

revoke execute on function public.delete_supplier_bill(uuid) from public, anon;
grant execute on function public.delete_supplier_bill(uuid) to authenticated;
