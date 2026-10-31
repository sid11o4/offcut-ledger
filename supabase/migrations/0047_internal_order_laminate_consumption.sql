-- Internal Order laminate consumption.
--
-- A single-side job uses one raw board and one laminate (skin) per sheet; a double-side job uses one
-- raw board and two laminates (skin 1 and skin 2) per sheet. The sheet count sets how much of each is
-- consumed. Factory staff should not be blocked by stock that has not been entered yet, so:
--   * an Internal Order consumption is never refused. It takes whatever the project and company hold
--     and lets the balance go negative for the rest. A later purchase brings it back up.
--   * a material that is not in inventory yet is created on the spot (ensure_inventory_item).
--   * a purchase that arrives after a negative balance is costed at its own price, not blended with
--     the negative stock, which had no cost on the books.
-- Every other outflow (transfers, manual slips, consumption elsewhere) still refuses to go negative.

-- Creates an inventory item by name when no active item has that name yet. Returns its id.
create or replace function public.ensure_inventory_item(p_name text, p_unit_code text default 'SHEET')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_unit uuid;
  v_id uuid;
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  if v_name = '' then raise exception 'A material name is required.'; end if;

  select id into v_id from public.inventory_items
    where lower(btrim(name)) = lower(v_name) and active
    order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_unit from public.units where code = p_unit_code and active;
  if v_unit is null then raise exception 'Unit % is not set up.', p_unit_code; end if;

  insert into public.inventory_items (name, unit_id, track_as_inventory, created_by)
  values (v_name, v_unit, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_inventory_item(text, text) from public, anon;
grant execute on function public.ensure_inventory_item(text, text) to authenticated;

-- The only writer of inventory movements. Same as before, except for the internal_order rules above.
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
    -- Stock that went negative carried no cost on the books, so a purchase that brings it back
    -- above zero is costed at its own price rather than blended with that zero-value shortfall.
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
    v_new_avg := v_current.avg_unit_cost; -- an outflow never changes the average
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

  return v_txn_id;
end;
$function$;

-- Consumes stock from a project's own location, topping it up from company inventory first. For an
-- Internal Order the top-up is whatever company holds, and the project goes negative for the rest.
create or replace function public.record_inventory_consumption(
  p_item_id uuid, p_design_project_id uuid, p_quantity numeric,
  p_txn_date date default current_date, p_reference_type text default 'manual_slip'::text,
  p_reference_id uuid default null::uuid, p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_project_location uuid;
  v_company_location uuid;
  v_project_qty numeric;
  v_company_qty numeric;
  v_shortfall numeric;
begin
  if p_quantity <= 0 then raise exception 'Consumption quantity must be greater than zero.'; end if;

  select id into v_project_location from public.inventory_locations
    where kind = 'project' and design_project_id = p_design_project_id;
  if v_project_location is null then raise exception 'No inventory location for this project.'; end if;
  select id into v_company_location from public.inventory_locations where kind = 'company';

  select coalesce(quantity, 0) into v_project_qty from public.inventory_stock
    where location_id = v_project_location and item_id = p_item_id;
  v_project_qty := coalesce(v_project_qty, 0);

  if v_project_qty < p_quantity then
    v_shortfall := p_quantity - v_project_qty;
    select coalesce(quantity, 0) into v_company_qty from public.inventory_stock
      where location_id = v_company_location and item_id = p_item_id;
    v_company_qty := coalesce(v_company_qty, 0);

    if p_reference_type = 'internal_order' then
      if v_company_qty > 0 then
        perform public.record_inventory_transfer(
          p_item_id, v_company_location, v_project_location, least(v_company_qty, v_shortfall), p_txn_date,
          'Auto-transfer to cover internal order consumption.');
      end if;
    else
      if v_company_qty < v_shortfall then
        raise exception 'Not enough stock to consume: % short at project, and only % available in company inventory. Purchase more before recording this consumption.',
          v_shortfall, v_company_qty;
      end if;
      perform public.record_inventory_transfer(
        p_item_id, v_company_location, v_project_location, v_shortfall, p_txn_date,
        'Auto-transfer to cover consumption shortfall.');
    end if;
  end if;

  return public.record_inventory_transaction(
    'consumption', p_item_id, v_project_location, -p_quantity, null, p_txn_date,
    p_reference_type, p_reference_id, p_notes);
end;
$function$;
