-- When stock comes into the company pool, it first clears any shortfall the same item has at a
-- project location (a project that consumed more than it held, and went negative). Only the
-- company stock left after that stays in the pool. Consumption still draws project stock first,
-- then company stock, and goes negative only when both are short.
create or replace function public.settle_negative_stock(p_item_id uuid, p_txn_date date default current_date)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_avail numeric;
  r record;
  v_take numeric;
  v_moved numeric := 0;
begin
  select id into v_company from public.inventory_locations where kind = 'company';
  if v_company is null then return 0; end if;

  select coalesce(quantity, 0) into v_avail from public.inventory_stock
    where location_id = v_company and item_id = p_item_id;
  v_avail := coalesce(v_avail, 0);
  if v_avail <= 0 then return 0; end if;

  for r in
    select s.location_id, -s.quantity as short_by
    from public.inventory_stock s
    join public.inventory_locations l on l.id = s.location_id
    where s.item_id = p_item_id and s.quantity < 0 and l.kind = 'project'
    order by s.updated_at
  loop
    exit when v_avail <= 0;
    v_take := least(r.short_by, v_avail);
    perform public.record_inventory_transfer(
      p_item_id, v_company, r.location_id, v_take, p_txn_date,
      'Stock added to company inventory covers the project shortfall.');
    v_avail := v_avail - v_take;
    v_moved := v_moved + v_take;
  end loop;

  return v_moved;
end;
$$;

revoke all on function public.settle_negative_stock(uuid, date) from public, anon, authenticated;

-- Redefine the transaction writer: after a positive movement lands in the company pool, settle any
-- project shortfalls for that item. Outflows and project-side inflows never trigger it, so the
-- settlement's own transfers cannot recurse.
create or replace function public.record_inventory_transaction(
  p_txn_type text, p_item_id uuid, p_location_id uuid, p_quantity numeric,
  p_unit_cost numeric, p_txn_date date, p_reference_type text, p_reference_id uuid,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_txn_id uuid;
  v_current record;
  v_new_qty numeric;
  v_new_avg numeric;
  v_effective_unit_cost numeric;
  v_total_cost numeric;
  v_is_company boolean;
begin
  if not public.is_active_user() then
    raise exception 'Your account is inactive.';
  end if;
  if p_quantity = 0 then
    raise exception 'Transaction quantity cannot be zero.';
  end if;

  select quantity, avg_unit_cost into v_current
  from public.inventory_stock where location_id = p_location_id and item_id = p_item_id
  for update;
  if not found then
    insert into public.inventory_stock (location_id, item_id, quantity, avg_unit_cost)
    values (p_location_id, p_item_id, 0, 0);
    v_current.quantity := 0;
    v_current.avg_unit_cost := 0;
  end if;

  if p_quantity > 0 then
    v_effective_unit_cost := coalesce(p_unit_cost, 0);
    v_new_qty := v_current.quantity + p_quantity;
    v_new_avg := case
      when v_new_qty <= 0 then 0
      when v_current.quantity <= 0 then v_effective_unit_cost
      else ((v_current.quantity * v_current.avg_unit_cost) + (p_quantity * v_effective_unit_cost)) / v_new_qty
    end;
  else
    if p_reference_type <> 'internal_order' and v_current.quantity + p_quantity < -0.0001 then
      raise exception 'Not enough stock: % available, % requested at this location.',
        v_current.quantity, -p_quantity;
    end if;
    v_effective_unit_cost := v_current.avg_unit_cost;
    v_new_qty := v_current.quantity + p_quantity;
    v_new_avg := v_current.avg_unit_cost;
  end if;
  v_total_cost := round(p_quantity * v_effective_unit_cost, 2);

  insert into public.inventory_transactions
    (txn_type, item_id, location_id, quantity, unit_cost, total_cost, txn_date,
     reference_type, reference_id, notes, created_by)
  values
    (p_txn_type, p_item_id, p_location_id, p_quantity, v_effective_unit_cost, v_total_cost, p_txn_date,
     p_reference_type, p_reference_id, p_notes, auth.uid())
  returning id into v_txn_id;

  update public.inventory_stock
    set quantity = v_new_qty, avg_unit_cost = v_new_avg, updated_at = now()
    where location_id = p_location_id and item_id = p_item_id;

  select kind = 'company' into v_is_company from public.inventory_locations where id = p_location_id;
  if p_quantity > 0 and coalesce(v_is_company, false) then
    perform public.settle_negative_stock(p_item_id, p_txn_date);
  end if;

  return v_txn_id;
end;
$function$;
