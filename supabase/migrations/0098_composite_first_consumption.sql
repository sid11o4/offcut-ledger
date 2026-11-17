-- When a Design Build Order job work uses a raw board with one or two skins, a composite material held
-- for exactly that combination is used first. Boards and skins are deducted from the simple materials
-- only for what the composite stock cannot cover. The skins match in either order.
create or replace function public.bill_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_billed boolean;
  v_status text;
  v_entry record;
  v_design_project_id uuid;
  v_composite uuid;
  v_avail numeric;
  v_used numeric := 0;
  v_sheets numeric;
begin
  select billed, status into v_billed, v_status
  from public.job_work_entries
  where id = new.job_work_entry_id
  for update;

  if v_status is null then
    raise exception 'Job-work entry % does not exist.', new.job_work_entry_id;
  end if;
  if v_status <> 'active' then
    raise exception 'Cannot bill a cancelled job-work entry.';
  end if;
  if v_billed then
    raise exception 'Job-work entry % is already billed.', new.job_work_entry_id;
  end if;

  update public.job_work_entries
    set billed = true, bill_item_id = new.id
    where id = new.job_work_entry_id;

  select e.*, dp.id as linked_design_project_id into v_entry
  from public.job_work_entries e
  left join public.design_projects dp on dp.factory_project_id = e.project_id
  where e.id = new.job_work_entry_id;

  v_design_project_id := v_entry.linked_design_project_id;

  if v_design_project_id is not null then
    -- A composite held for this board and skin combination covers as much of the job as it can.
    if v_entry.raw_material_item_id is not null and v_entry.skin1_item_id is not null
       and coalesce(v_entry.raw_material_qty, 0) > 0 then
      v_sheets := v_entry.raw_material_qty;
      select i.id,
        coalesce((select sum(s.quantity) from public.inventory_stock s
                  join public.inventory_locations l on l.id = s.location_id
                  where s.item_id = i.id and s.quantity > 0
                    and (l.kind = 'company' or l.design_project_id = v_design_project_id)), 0)
        into v_composite, v_avail
      from public.inventory_items i
      where i.is_composite and i.active
        and exists (select 1 from public.inventory_composite_parts p
                    where p.item_id = i.id and p.role = 'raw' and p.component_item_id = v_entry.raw_material_item_id)
        and (select coalesce(array_agg(p.component_item_id order by p.component_item_id), '{}'::uuid[])
             from public.inventory_composite_parts p where p.item_id = i.id and p.role in ('skin1', 'skin2'))
          = (select coalesce(array_agg(x order by x), '{}'::uuid[])
             from unnest(array[v_entry.skin1_item_id, v_entry.skin2_item_id]) x where x is not null)
      order by 2 desc
      limit 1;

      if v_composite is not null and v_avail > 0 then
        v_used := least(v_avail, v_sheets);
        perform public.record_inventory_consumption(
          v_composite, v_design_project_id, v_used, v_entry.entry_date,
          'internal_order', new.id, 'Composite material for Design Build Order job-work, billed ' || new.id);
      end if;
    end if;

    if v_entry.raw_material_item_id is not null and coalesce(v_entry.raw_material_qty, 0) - v_used > 0 then
      perform public.record_inventory_consumption(
        v_entry.raw_material_item_id, v_design_project_id, v_entry.raw_material_qty - v_used, v_entry.entry_date,
        'internal_order', new.id, 'Raw material for Design Build Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin1_item_id is not null and coalesce(v_entry.skin1_qty, 0) - v_used > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin1_item_id, v_design_project_id, v_entry.skin1_qty - v_used, v_entry.entry_date,
        'internal_order', new.id, 'Skin 1 (lamination) for Design Build Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin2_item_id is not null and coalesce(v_entry.skin2_qty, 0) - v_used > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin2_item_id, v_design_project_id, v_entry.skin2_qty - v_used, v_entry.entry_date,
        'internal_order', new.id, 'Skin 2 (double-side lamination) for Design Build Order job-work, billed ' || new.id);
    end if;
  end if;

  return new;
end;
$function$;
