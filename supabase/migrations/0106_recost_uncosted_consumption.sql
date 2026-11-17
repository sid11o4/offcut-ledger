-- Material consumed before it was bought leaves the stock negative, and an outflow is costed at the
-- location's average cost, which is 0 when nothing was bought yet. So the consumption was recorded at
-- Rs 0 and never showed in the project's costs, even after the purchase arrived.
-- When stock arrives at a location that is short, the earlier consumption at cost 0 is now costed at
-- the incoming unit cost, up to the quantity the arrival covers.
create or replace function public.recost_uncosted_consumption(p_item_id uuid, p_location_id uuid, p_unit_cost numeric, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_t record;
  v_left numeric := p_quantity;
  v_take numeric;
begin
  if coalesce(p_unit_cost, 0) <= 0 or p_quantity <= 0 then return; end if;
  for v_t in
    select id, quantity, unit_cost, total_cost from public.inventory_transactions
    where item_id = p_item_id and location_id = p_location_id and txn_type = 'consumption'
      and reversed_by is null and unit_cost = 0 and quantity < 0
    order by created_at, id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(-v_t.quantity, v_left);
    update public.inventory_transactions
      set unit_cost = round(p_unit_cost * v_take / -v_t.quantity, 4),
          total_cost = -round(v_take * p_unit_cost, 2)
      where id = v_t.id;
    v_left := v_left - v_take;
  end loop;
end;
$function$;
revoke all on function public.recost_uncosted_consumption(uuid, uuid, numeric, numeric) from public, anon, authenticated;

create or replace function public.record_inventory_transaction(p_txn_type text, p_item_id uuid, p_location_id uuid, p_quantity numeric, p_unit_cost numeric, p_txn_date date, p_reference_type text, p_reference_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- A Design Build Order job work and a manual consumption slip may use material that is not (yet) in
    -- stock: the balance goes negative until the purchase is recorded. Nothing else may go below zero.
    if not (p_reference_type = 'internal_order' or (p_reference_type = 'manual_slip' and p_txn_type = 'consumption'))
       and v_current.quantity + p_quantity < -0.0001 then
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

  -- Stock arriving where earlier consumption was recorded at no cost: cost that consumption now.
  if p_quantity > 0 and p_txn_type in ('purchase', 'transfer_in') and v_current.quantity < 0 then
    perform public.recost_uncosted_consumption(p_item_id, p_location_id, v_effective_unit_cost, least(p_quantity, -v_current.quantity));
  end if;

  select kind = 'company' into v_is_company from public.inventory_locations where id = p_location_id;
  if p_quantity > 0 and coalesce(v_is_company, false) then
    perform public.settle_negative_stock(p_item_id, p_txn_date);
  end if;

  return v_txn_id;
end;
$function$;

-- Cost the consumption already on the books at no cost, from what was bought at that location.
do $$
declare r record;
begin
  for r in
    select t.item_id, t.location_id,
           sum(t.quantity) as qty, sum(t.total_cost) as cost
    from public.inventory_transactions t
    join public.inventory_locations l on l.id = t.location_id and l.kind = 'project'
    where t.txn_type in ('purchase', 'transfer_in') and t.reversed_by is null and t.unit_cost > 0
      and exists (select 1 from public.inventory_transactions c
                  where c.item_id = t.item_id and c.location_id = t.location_id and c.txn_type = 'consumption'
                    and c.reversed_by is null and c.unit_cost = 0)
    group by t.item_id, t.location_id
    having sum(t.quantity) > 0
  loop
    perform public.recost_uncosted_consumption(r.item_id, r.location_id, r.cost / r.qty, r.qty);
  end loop;
end $$;
