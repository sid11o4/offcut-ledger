-- The pasting and fevicol job work built into a composite is Factory income. It is billed as Design
-- Build Order job work to a company-level Design Build project (not tied to any one design project:
-- the cost to Design Build stays inside the composite's inventory value), one Pasting entry and one
-- FEVICOL entry for the skins pasted, at the active Design Build Order rates.

create or replace function public.design_build_company_project()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_project uuid;
  v_cat uuid;
begin
  select id into v_project from public.projects where code = 'DB-COMPANY';
  if v_project is not null then return v_project; end if;
  select id into v_cat from public.rate_categories where name = 'Design Build Order';
  if v_cat is null then raise exception 'The Design Build Order rate category is not set up.'; end if;
  select id into v_client from public.clients where code = 'DB-COMPANY';
  if v_client is null then
    insert into public.clients (code, name) values ('DB-COMPANY', 'Design Build Company') returning id into v_client;
  end if;
  insert into public.projects (code, name, client_id, rate_category_id, status)
  values ('DB-COMPANY', 'Design Build Company', v_client, v_cat, 'active')
  returning id into v_project;
  return v_project;
end;
$$;
revoke all on function public.design_build_company_project() from public, anon, authenticated;

-- Records the Pasting and FEVICOL job work for p_quantity pieces of a composite: one of each per skin.
create or replace function public.bill_composite_job_work(p_item_id uuid, p_quantity numeric, p_date date, p_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skins int;
  v_project uuid;
  v_service uuid;
begin
  select count(*) into v_skins from public.inventory_composite_parts where item_id = p_item_id and role in ('skin1', 'skin2');
  if v_skins = 0 or p_quantity <= 0 then return; end if;
  v_project := public.design_build_company_project();
  for v_service in select id from public.job_work_services where name in ('Pasting', 'FEVICOL') and active loop
    perform public.record_job_work_entry(p_date, v_project, v_service, p_quantity * v_skins, p_remarks);
  end loop;
end;
$$;
revoke all on function public.bill_composite_job_work(uuid, numeric, date, text) from public, anon, authenticated;

create or replace function public.make_composite(p_item_id uuid, p_quantity numeric, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid;
  v_part record;
  v_unit_cost numeric := 0;
  v_stock record;
  v_name text;
  v_skins int;
  v_txn uuid;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to make composite materials.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter how many to make.'; end if;
  select name into v_name from public.inventory_items where id = p_item_id and is_composite;
  if v_name is null then raise exception 'That is not a composite material.'; end if;
  select id into v_loc from public.inventory_locations where kind = 'company' limit 1;

  for v_part in select * from public.inventory_composite_parts
    where item_id = p_item_id and role in ('raw', 'skin1', 'skin2') order by sort_order loop
    select quantity, avg_unit_cost into v_stock from public.inventory_stock
      where location_id = v_loc and item_id = v_part.component_item_id;
    if not found or v_stock.quantity < p_quantity then
      raise exception 'Not enough % in company stock: % available, % needed.',
        (select name from public.inventory_items where id = v_part.component_item_id),
        coalesce(v_stock.quantity, 0), p_quantity;
    end if;
  end loop;

  for v_part in select * from public.inventory_composite_parts
    where item_id = p_item_id and role in ('raw', 'skin1', 'skin2') order by sort_order loop
    select avg_unit_cost into v_stock from public.inventory_stock
      where location_id = v_loc and item_id = v_part.component_item_id;
    v_unit_cost := v_unit_cost + coalesce(v_stock.avg_unit_cost, 0);
    perform public.record_inventory_transaction('consumption', v_part.component_item_id, v_loc, -p_quantity, 0,
      p_date, 'adjustment', p_item_id, 'Used to make ' || v_name);
  end loop;

  select count(*) into v_skins from public.inventory_composite_parts where item_id = p_item_id and role in ('skin1', 'skin2');
  select v_unit_cost + coalesce(sum(unit_cost), 0) + v_skins * public.composite_pasting_rate() into v_unit_cost
    from public.inventory_composite_parts where item_id = p_item_id and role = 'jobwork';

  v_txn := public.record_inventory_transaction('purchase', p_item_id, v_loc, p_quantity, v_unit_cost,
    p_date, 'adjustment', p_item_id, 'Made from its materials');

  -- The pasting with fevicol done on these pieces is Factory job work income.
  perform public.bill_composite_job_work(p_item_id, p_quantity, p_date, 'Pasting w/ fevicol for composite: ' || v_name);
  return v_txn;
end;
$$;
