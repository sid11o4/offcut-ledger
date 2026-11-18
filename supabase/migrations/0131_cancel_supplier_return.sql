-- Cancel a return: the stock goes back where it was taken from, the slip and its credit follow-up are removed (so it no
-- longer shows in vendor credit or payables), and a record of the cancelled slip is kept. A return whose credit has already
-- been settled (refunded or adjusted against a bill) cannot be cancelled.
create table if not exists public.supplier_return_cancellations (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null,
  slip_number text not null,
  supplier_id uuid,
  total_amount numeric,
  reason text not null,
  slip_snapshot jsonb not null,
  cancelled_by uuid default auth.uid(),
  cancelled_at timestamptz not null default now()
);
alter table public.supplier_return_cancellations enable row level security;
drop policy if exists supplier_return_cancellations_read on public.supplier_return_cancellations;
create policy supplier_return_cancellations_read on public.supplier_return_cancellations for select to authenticated
  using (public.has_permission('inventory_operate') or public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));

create or replace function public.cancel_supplier_return(p_slip_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slip public.supplier_return_slips;
  v_txn record;
  v_items jsonb;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to cancel a return.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the return is cancelled.'; end if;
  select * into v_slip from public.supplier_return_slips where id = p_slip_id for update;
  if v_slip.id is null then raise exception 'Return slip not found.'; end if;
  if v_slip.credit_status = 'settled' then
    raise exception 'This return''s credit has already been settled (refunded or adjusted against a bill), so it cannot be cancelled.';
  end if;

  for v_txn in
    select id from public.inventory_transactions
    where reference_type = 'manual_slip' and reference_id = p_slip_id and txn_type = 'adjustment' and quantity < 0 and reversed_by is null
  loop
    perform public.reverse_inventory_transaction(v_txn.id, 'Return ' || v_slip.slip_number || ' cancelled: ' || btrim(p_reason));
  end loop;

  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_items from public.supplier_return_slip_items i where i.slip_id = p_slip_id;
  insert into public.supplier_return_cancellations (slip_id, slip_number, supplier_id, total_amount, reason, slip_snapshot)
    values (v_slip.id, v_slip.slip_number, v_slip.supplier_id, v_slip.total_amount, btrim(p_reason),
            to_jsonb(v_slip) || jsonb_build_object('items', v_items));
  delete from public.supplier_return_slips where id = p_slip_id;
end;
$$;
revoke execute on function public.cancel_supplier_return(uuid, text) from public, anon;
grant execute on function public.cancel_supplier_return(uuid, text) to authenticated;
