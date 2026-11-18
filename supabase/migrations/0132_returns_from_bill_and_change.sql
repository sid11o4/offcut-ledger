-- Returns: change a return's items, and return items straight from a vendor bill's lines (not only from what inventory shows).
--  * a slip made from a bill remembers the bill and the bill lines (quantity already returned is tracked on the line)
--  * stock goes out only for what is actually in stock at the location the bill posted it to; a line consumed directly
--    (or already used) has no stock to take out, and the credit is still at the bill's rate
--  * a line consumed directly has its returned part taken off the project cost
alter table public.supplier_return_slips add column if not exists bill_id uuid references public.supplier_bills(id) on delete set null;
alter table public.supplier_return_slip_items alter column item_id drop not null;
alter table public.supplier_return_slip_items add column if not exists description text;
alter table public.supplier_return_slip_items add column if not exists bill_item_id uuid references public.supplier_bill_items(id) on delete set null;
alter table public.supplier_bill_items add column if not exists returned_qty numeric not null default 0;

-- Adds the lines of a slip (stock out where there is stock) and returns the slip total. Internal.
create or replace function public._add_return_lines(p_slip_id uuid, p_items jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_slip public.supplier_return_slips;
  v_line jsonb;
  v_sum numeric := 0;
  v_qty numeric;
  v_txn uuid;
  v_unit numeric;
  v_total numeric;
  v_bi public.supplier_bill_items;
  v_loc uuid;
  v_stock numeric;
  v_out numeric;
  v_amt numeric;
begin
  select * into v_slip from public.supplier_return_slips where id = p_slip_id;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item to the return slip.';
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Each returned quantity must be above zero.'; end if;

    if v_slip.bill_id is null then
      v_txn := public.record_inventory_transaction(
        'adjustment', (v_line->>'item_id')::uuid, v_slip.location_id, -v_qty, null, v_slip.return_date, 'manual_slip', v_slip.id,
        'Returned to supplier on ' || v_slip.slip_number);
      select abs(unit_cost), abs(total_cost) into v_unit, v_total from public.inventory_transactions where id = v_txn;
      insert into public.supplier_return_slip_items (slip_id, item_id, quantity, unit_cost, total_amount, reason)
        values (v_slip.id, (v_line->>'item_id')::uuid, v_qty, coalesce(v_unit, 0), coalesce(v_total, 0), nullif(btrim(v_line->>'reason'), ''));
      v_sum := v_sum + coalesce(v_total, 0);
    else
      select * into v_bi from public.supplier_bill_items where id = (v_line->>'bill_item_id')::uuid and bill_id = v_slip.bill_id;
      if v_bi.id is null then raise exception 'That line is not on this bill.'; end if;
      if v_qty > v_bi.quantity - coalesce(v_bi.returned_qty, 0) + 0.0001 then
        raise exception 'Only % of "%" is left to return on this bill.', v_bi.quantity - coalesce(v_bi.returned_qty, 0), v_bi.description;
      end if;
      v_amt := round(v_qty * v_bi.rate_inclusive, 2);
      if v_bi.inventory_item_id is not null and not v_bi.consumed_directly then
        select location_id into v_loc from public.inventory_transactions
          where reference_type = 'supplier_bill' and reference_id = v_slip.bill_id and item_id = v_bi.inventory_item_id and txn_type = 'purchase'
          order by created_at limit 1;
        if v_loc is not null then
          select greatest(quantity, 0) into v_stock from public.inventory_stock where location_id = v_loc and item_id = v_bi.inventory_item_id;
          v_out := least(v_qty, coalesce(v_stock, 0));
          if v_out > 0.0001 then
            perform public.record_inventory_transaction('adjustment', v_bi.inventory_item_id, v_loc, -v_out, null, v_slip.return_date,
              'manual_slip', v_slip.id, 'Returned to supplier on ' || v_slip.slip_number);
          end if;
        end if;
      end if;
      insert into public.supplier_return_slip_items (slip_id, item_id, bill_item_id, description, quantity, unit_cost, total_amount, reason)
        values (v_slip.id, v_bi.inventory_item_id, v_bi.id, v_bi.description, v_qty, v_bi.rate_inclusive, v_amt, nullif(btrim(v_line->>'reason'), ''));
      update public.supplier_bill_items set returned_qty = coalesce(returned_qty, 0) + v_qty where id = v_bi.id;
      v_sum := v_sum + v_amt;
    end if;
  end loop;
  return v_sum;
end;
$$;
revoke execute on function public._add_return_lines(uuid, jsonb) from public, anon, authenticated;

-- Takes a slip's stock movements back and frees what it returned from bill lines. Internal.
create or replace function public._undo_return_lines(p_slip_id uuid, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare v_txn record; v_number text;
begin
  select slip_number into v_number from public.supplier_return_slips where id = p_slip_id;
  for v_txn in
    select id from public.inventory_transactions
    where reference_type = 'manual_slip' and reference_id = p_slip_id and txn_type = 'adjustment' and quantity < 0 and reversed_by is null
  loop
    perform public.reverse_inventory_transaction(v_txn.id, 'Return ' || v_number || ' ' || p_why);
  end loop;
  update public.supplier_bill_items b set returned_qty = greatest(coalesce(b.returned_qty, 0) - s.quantity, 0)
    from public.supplier_return_slip_items s where s.slip_id = p_slip_id and s.bill_item_id = b.id;
end;
$$;
revoke execute on function public._undo_return_lines(uuid, text) from public, anon, authenticated;

create or replace function public.cancel_supplier_return(p_slip_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slip public.supplier_return_slips;
  v_items jsonb;
begin
  if not public.has_permission('inventory_operate') then raise exception 'You do not have permission to cancel a return.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the return is cancelled.'; end if;
  select * into v_slip from public.supplier_return_slips where id = p_slip_id for update;
  if v_slip.id is null then raise exception 'Return slip not found.'; end if;
  if v_slip.credit_status = 'settled' then
    raise exception 'This return''s credit has already been settled (refunded or adjusted against a bill), so it cannot be cancelled.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_items from public.supplier_return_slip_items i where i.slip_id = p_slip_id;
  perform public._undo_return_lines(p_slip_id, 'cancelled: ' || btrim(p_reason));
  insert into public.supplier_return_cancellations (slip_id, slip_number, supplier_id, total_amount, reason, slip_snapshot)
    values (v_slip.id, v_slip.slip_number, v_slip.supplier_id, v_slip.total_amount, btrim(p_reason), to_jsonb(v_slip) || jsonb_build_object('items', v_items));
  delete from public.supplier_return_slips where id = p_slip_id;
end;
$$;
revoke execute on function public.cancel_supplier_return(uuid, text) from public, anon;
grant execute on function public.cancel_supplier_return(uuid, text) to authenticated;

-- Change the items of a return. A slip from a bill takes lines like [{bill_item_id, quantity}], other slips [{item_id, quantity}].
create or replace function public.change_supplier_return(p_slip_id uuid, p_items jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_slip public.supplier_return_slips; v_total numeric;
begin
  if not public.has_permission('inventory_operate') then raise exception 'You do not have permission to change a return.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the return is changed.'; end if;
  select * into v_slip from public.supplier_return_slips where id = p_slip_id for update;
  if v_slip.id is null then raise exception 'Return slip not found.'; end if;
  if v_slip.credit_status = 'settled' then
    raise exception 'This return''s credit has already been settled, so its items cannot be changed.';
  end if;
  perform public._undo_return_lines(p_slip_id, 'changed: ' || btrim(p_reason));
  delete from public.supplier_return_slip_items where slip_id = p_slip_id;
  v_total := public._add_return_lines(p_slip_id, p_items);
  update public.supplier_return_slips set total_amount = v_total where id = p_slip_id;
end;
$$;
revoke execute on function public.change_supplier_return(uuid, jsonb, text) from public, anon;
grant execute on function public.change_supplier_return(uuid, jsonb, text) to authenticated;

-- Return items from a vendor bill's lines: [{bill_item_id, quantity, reason?}].
create or replace function public.create_supplier_return_from_bill(p_bill_id uuid, p_return_date date, p_reason text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bill public.supplier_bills; v_slip_id uuid; v_number text; v_loc uuid; v_total numeric;
begin
  if not public.has_permission('inventory_operate') then raise exception 'You do not have permission to return stock to a supplier.'; end if;
  select * into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'approved' or v_bill.bill_source <> 'vendor' then raise exception 'Items can be returned from an approved vendor bill.'; end if;
  if v_bill.supplier_id is null then raise exception 'This bill has no supplier.'; end if;
  v_loc := public.bill_location_for(v_bill.design_project_id);
  v_number := 'RTN-' || lpad(nextval('public.supplier_return_slip_seq')::text, 4, '0');
  insert into public.supplier_return_slips (slip_number, return_date, supplier_id, location_id, reason, bill_id)
    values (v_number, coalesce(p_return_date, current_date), v_bill.supplier_id, v_loc, nullif(btrim(p_reason), ''), v_bill.id)
    returning id into v_slip_id;
  v_total := public._add_return_lines(v_slip_id, p_lines);
  update public.supplier_return_slips set total_amount = v_total where id = v_slip_id;
  return v_slip_id;
end;
$$;
revoke execute on function public.create_supplier_return_from_bill(uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_supplier_return_from_bill(uuid, date, text, jsonb) to authenticated;

-- A line consumed directly costs the project only what was not returned.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'design_build_cost_breakdown' and pronamespace = 'public'::regnamespace;
  if position('i.total_amount as amount, b.bill_date as dt' in d) = 0 then raise exception 'breakdown marker missing'; end if;
  d := replace(d, 'i.total_amount as amount, b.bill_date as dt',
    'i.total_amount * (1 - case when i.consumed_directly then least(coalesce(i.returned_qty, 0) / nullif(i.quantity, 0), 1) else 0 end) as amount, b.bill_date as dt');
  execute d;
end $$;
