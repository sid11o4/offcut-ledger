-- A mistaken stock entry is reversed, not deleted: a reversing entry is posted against it, and the
-- original is marked as reversed. The audit trail stays, and stock, lots and reports follow the net.
alter table public.inventory_transactions add column if not exists reversed_by uuid references public.inventory_transactions(id);

create or replace function public.apply_lot_movement(p_txn public.inventory_transactions)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric;
  v_take numeric;
  v_lot record;
  v_out_id uuid;
  v_draw record;
  v_bill uuid;
  v_text text;
  v_new_lot uuid;
begin
  if p_txn.quantity > 0 then
    v_remaining := p_txn.quantity;
    for v_lot in select * from public.inventory_lots
      where item_id = p_txn.item_id and location_id = p_txn.location_id and remaining < 0
      order by seq loop
      exit when v_remaining <= 0;
      v_take := least(-v_lot.remaining, v_remaining);
      update public.inventory_lots set remaining = remaining + v_take where id = v_lot.id;
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining <= 0 then return; end if;

    if p_txn.txn_type = 'adjustment' and p_txn.reference_id is not null
       and exists (select 1 from public.inventory_transactions where id = p_txn.reference_id) then
      -- A reversal brings back the lots that its original entry drew.
      for v_draw in select * from public.inventory_lot_draws where txn_id = p_txn.reference_id order by id loop
        exit when v_remaining <= 0;
        v_take := least(v_draw.quantity, v_remaining);
        insert into public.inventory_lots (item_id, location_id, vendor_bill_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, v_draw.vendor_bill_id, v_draw.vendor_text, v_draw.unit_cost, v_take, p_txn.id);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, 'Reversal (no vendor on record)', p_txn.unit_cost, v_remaining, p_txn.id);
      end if;
    elsif p_txn.txn_type = 'transfer_in' then
      select id into v_out_id from public.inventory_transactions
        where reference_id = p_txn.reference_id and txn_type = 'transfer_out' and item_id = p_txn.item_id
        order by created_at limit 1;
      for v_draw in select * from public.inventory_lot_draws where txn_id = v_out_id order by id loop
        exit when v_remaining <= 0;
        v_take := least(v_draw.quantity, v_remaining);
        insert into public.inventory_lots (item_id, location_id, vendor_bill_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, v_draw.vendor_bill_id, v_draw.vendor_text, v_draw.unit_cost, v_take, p_txn.id);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, 'Transfer (no vendor on record)', p_txn.unit_cost, v_remaining, p_txn.id);
      end if;
    else
      v_bill := case when p_txn.reference_type = 'supplier_bill' then p_txn.reference_id end;
      v_text := case when v_bill is null then 'Company purchase (no vendor)' end;
      insert into public.inventory_lots (item_id, location_id, vendor_bill_id, vendor_text, unit_cost, remaining, source_txn_id)
        values (p_txn.item_id, p_txn.location_id, v_bill, v_text, p_txn.unit_cost, v_remaining, p_txn.id);
    end if;
  else
    v_remaining := -p_txn.quantity;
    for v_lot in select * from public.inventory_lots
      where item_id = p_txn.item_id and location_id = p_txn.location_id and remaining > 0
      order by seq loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.remaining, v_remaining);
      update public.inventory_lots set remaining = remaining - v_take where id = v_lot.id;
      insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_bill_id, vendor_text)
        values (p_txn.id, v_lot.id, v_take, v_lot.unit_cost, v_lot.vendor_bill_id, v_lot.vendor_text);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)
        values (p_txn.item_id, p_txn.location_id, 'No purchase on record', 0, -v_remaining, p_txn.id)
        returning id into v_new_lot;
      insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_text)
        values (p_txn.id, v_new_lot, v_remaining, 0, 'No purchase on record');
    end if;
  end if;
end;
$$;

revoke all on function public.apply_lot_movement(public.inventory_transactions) from public, anon, authenticated;

create or replace function public.reverse_inventory_transaction(p_txn_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.inventory_transactions;
  v_leg public.inventory_transactions;
  v_new uuid;
  v_count integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to reverse inventory entries.';
  end if;
  if v_reason is null then raise exception 'Give a reason for the reversal.'; end if;

  select * into v_t from public.inventory_transactions where id = p_txn_id for update;
  if v_t.id is null then raise exception 'Entry not found.'; end if;
  if v_t.reversed_by is not null then raise exception 'This entry has already been reversed.'; end if;
  if v_t.txn_type = 'adjustment' and v_t.reference_id is not null
     and exists (select 1 from public.inventory_transactions where id = v_t.reference_id) then
    raise exception 'This entry is itself a reversal.';
  end if;
  if v_t.reference_type = 'supplier_bill' then
    raise exception 'This stock came from a supplier bill. Void the bill instead.';
  end if;
  if v_t.reference_type = 'internal_order' then
    raise exception 'This consumption belongs to a factory internal order. Correct the job-work entry instead.';
  end if;

  -- A transfer is reversed as a whole, both legs together.
  for v_leg in
    select * from public.inventory_transactions
    where reversed_by is null
      and (id = p_txn_id or (v_t.txn_type in ('transfer_in', 'transfer_out')
           and reference_id = v_t.reference_id and item_id = v_t.item_id and txn_type in ('transfer_in', 'transfer_out')))
    order by quantity desc
  loop
    v_new := public.record_inventory_transaction('adjustment', v_leg.item_id, v_leg.location_id, -v_leg.quantity,
      v_leg.unit_cost, v_leg.txn_date, 'adjustment', v_leg.id, 'Reversal: ' || v_reason);
    update public.inventory_transactions set reversed_by = v_new where id = v_leg.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reverse_inventory_transaction(uuid, text) from public, anon;
grant execute on function public.reverse_inventory_transaction(uuid, text) to authenticated;

-- Reversed entries do not count in the project's costs.
create or replace function public.report_design_project_financials(p_design_project_id uuid)
returns table(
  budget numeric, supplier_bills_total numeric, internal_order_total numeric,
  current_inventory_value numeric, inventory_in_value numeric, direct_expenses_total numeric,
  materials_consumed_total numeric, bill_expense_total numeric
)
language sql
stable
set search_path = public
as $function$
  select
    dp.budget,
    coalesce((select sum(b.grand_total) from public.supplier_bills b
      where b.design_project_id = dp.id and b.status = 'approved'), 0),
    coalesce((select sum(e.total_amount) from public.job_work_entries e
      where e.project_id = dp.factory_project_id and e.billed and e.status = 'active'), 0),
    coalesce((select sum(st.quantity * st.avg_unit_cost) from public.inventory_stock st
      join public.inventory_locations loc on loc.id = st.location_id
      where loc.design_project_id = dp.id), 0),
    coalesce((select sum(t.total_cost) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type in ('purchase', 'transfer_in') and t.reversed_by is null), 0),
    coalesce((select sum(x.amount) from public.design_build_expenses x
      where x.design_project_id = dp.id and x.status = 'active'), 0),
    coalesce((select sum(abs(t.total_cost)) from public.inventory_transactions t
      join public.inventory_locations loc on loc.id = t.location_id
      where loc.design_project_id = dp.id and t.txn_type = 'consumption' and t.reversed_by is null), 0),
    coalesce((select sum(i.total_amount) from public.supplier_bill_items i
      join public.supplier_bills b on b.id = i.bill_id
      where b.design_project_id = dp.id and b.status = 'approved' and i.inventory_item_id is null), 0)
  from public.design_projects dp
  where dp.id = p_design_project_id;
$function$;

revoke all on function public.report_design_project_financials(uuid) from public, anon;
grant execute on function public.report_design_project_financials(uuid) to authenticated;
