-- A project that consumed stock it did not hold was costed at zero when it went negative. When the
-- shortfall is covered from company stock, the consumption it covers is repriced at the company's
-- average cost, so the project report shows what the material actually cost.
create or replace function public.settle_negative_stock(p_item_id uuid, p_txn_date date default current_date)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_avail numeric;
  v_company_cost numeric;
  r record;
  c record;
  v_take numeric;
  v_left numeric;
  v_moved numeric := 0;
begin
  select id into v_company from public.inventory_locations where kind = 'company';
  if v_company is null then return 0; end if;

  select coalesce(quantity, 0), coalesce(avg_unit_cost, 0) into v_avail, v_company_cost
    from public.inventory_stock where location_id = v_company and item_id = p_item_id;
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

    -- Reprice the consumption this covers, oldest first, at the company's average cost.
    v_left := v_take;
    for c in
      select id, quantity from public.inventory_transactions
      where item_id = p_item_id and location_id = r.location_id and txn_type = 'consumption'
        and quantity < 0 and total_cost = 0
      order by created_at
    loop
      exit when v_left < -c.quantity;
      update public.inventory_transactions
        set unit_cost = v_company_cost, total_cost = round(c.quantity * v_company_cost, 2)
        where id = c.id;
      v_left := v_left + c.quantity;
    end loop;

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
