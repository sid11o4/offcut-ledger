-- A manual consumption slip, like a Design Build Order job work, may use a material that is not (yet) in
-- stock: it takes what company stock has and the project's balance goes negative for the rest, until the
-- purchase is recorded. Transfers and every other outflow still cannot go below zero.

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

  select kind = 'company' into v_is_company from public.inventory_locations where id = p_location_id;
  if p_quantity > 0 and coalesce(v_is_company, false) then
    perform public.settle_negative_stock(p_item_id, p_txn_date);
  end if;

  return v_txn_id;
end;
$function$;

create or replace function public.record_inventory_consumption(p_item_id uuid, p_design_project_id uuid, p_quantity numeric, p_txn_date date DEFAULT CURRENT_DATE, p_reference_type text DEFAULT 'manual_slip'::text, p_reference_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project_location uuid; v_company_location uuid; v_project_qty numeric; v_company_qty numeric; v_shortfall numeric;
begin
  if p_quantity <= 0 then raise exception 'Consumption quantity must be greater than zero.'; end if;
  select id into v_project_location from public.inventory_locations where kind = 'project' and design_project_id = p_design_project_id;
  if v_project_location is null then raise exception 'No inventory location for this project.'; end if;
  select id into v_company_location from public.inventory_locations where kind = 'company';
  select coalesce(quantity, 0) into v_project_qty from public.inventory_stock where location_id = v_project_location and item_id = p_item_id;
  v_project_qty := coalesce(v_project_qty, 0);
  if v_project_qty < p_quantity then
    v_shortfall := p_quantity - v_project_qty;
    select coalesce(quantity, 0) into v_company_qty from public.inventory_stock where location_id = v_company_location and item_id = p_item_id;
    v_company_qty := coalesce(v_company_qty, 0);
    if p_reference_type in ('internal_order', 'manual_slip') then
      if v_company_qty > 0 then
        perform public.record_inventory_transfer(p_item_id, v_company_location, v_project_location, least(v_company_qty, v_shortfall), p_txn_date, 'Auto-transfer to cover consumption.');
      end if;
    else
      if v_company_qty < v_shortfall then
        raise exception 'Not enough stock to consume: % short at project, and only % available in company inventory. Purchase more before recording this consumption.', v_shortfall, v_company_qty;
      end if;
      perform public.record_inventory_transfer(p_item_id, v_company_location, v_project_location, v_shortfall, p_txn_date, 'Auto-transfer to cover consumption shortfall.');
    end if;
  end if;
  return public.record_inventory_transaction('consumption', p_item_id, v_project_location, -p_quantity, null, p_txn_date, p_reference_type, p_reference_id, p_notes);
end; $function$;
