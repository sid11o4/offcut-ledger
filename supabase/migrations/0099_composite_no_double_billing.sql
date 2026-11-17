-- A composite already carries the pasting and fevicol that was billed to Factory when it was made. When a
-- Design Build Order job work is covered by a matching composite, only Cutting is billed for those sheets,
-- whatever the job work is called: every other charge (pasting, fevicol and the rest) is waived for them,
-- and a job work with no Cutting in it is charged Cutting for those sheets. The same work is never billed twice. The composite is chosen when the
-- entry is recorded (stock not already claimed by other unbilled entries) and stored on the entry;
-- billing then consumes exactly that composite, and the boards and skins only for the rest.

alter table public.job_work_entries add column if not exists composite_item_id uuid references public.inventory_items(id);
alter table public.job_work_entries add column if not exists composite_qty numeric not null default 0;

create or replace function public.record_job_work_entry(
  p_entry_date date, p_project_id uuid, p_service_id uuid, p_base_quantity numeric,
  p_remarks text default null::text, p_rate_overrides jsonb default null::jsonb, p_unit_id uuid default null::uuid,
  p_raw_material_item_id uuid default null::uuid, p_raw_material_qty numeric default null::numeric,
  p_skin1_item_id uuid default null::uuid, p_skin1_qty numeric default null::numeric,
  p_skin2_item_id uuid default null::uuid, p_skin2_qty numeric default null::numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project record; v_service record; v_unit_id uuid; v_entry_id uuid; v_component record;
  v_override jsonb; v_rate_id uuid; v_rate_value numeric; v_is_override boolean;
  v_override_reason text; v_amount numeric; v_total numeric := 0;
  v_process_id uuid; v_process_active boolean; v_machine_id uuid;
  v_internal boolean; v_dp uuid; v_comp uuid; v_avail numeric; v_c numeric := 0; v_cq numeric; v_cname text;
  v_cut_id uuid; v_cut_done boolean := false; v_cut_rate_id uuid; v_cut_rate numeric;
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  if p_base_quantity is null or p_base_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  select id, client_id, rate_category_id, status into v_project from public.projects where id = p_project_id;
  if v_project.id is null then raise exception 'Project not found.'; end if;
  if v_project.status = 'cancelled' then raise exception 'Project is cancelled; reopen it before recording new work against it.'; end if;

  select id, unit_id, active into v_service from public.job_work_services where id = p_service_id;
  if v_service.id is null then raise exception 'Job-work service not found.'; end if;
  if not v_service.active then raise exception 'This job-work service is deactivated and cannot be used for new entries.'; end if;

  v_unit_id := coalesce(p_unit_id, v_service.unit_id);
  if not exists (select 1 from public.units where id = v_unit_id and active) then
    raise exception 'The selected unit is not a valid active unit.';
  end if;

  if p_rate_overrides is not null and jsonb_array_length(p_rate_overrides) > 0
     and not public.has_permission('rate_override') then
    raise exception 'You do not have permission to override rates.';
  end if;

  -- A composite held for exactly this board and skin combination covers as many sheets as it can.
  select exists (select 1 from public.rate_categories rc where rc.id = v_project.rate_category_id and rc.code = 'INTERNAL')
    into v_internal;
  if v_internal and p_raw_material_item_id is not null and p_skin1_item_id is not null and coalesce(p_raw_material_qty, 0) > 0 then
    select id into v_dp from public.design_projects where factory_project_id = p_project_id;
    select i.id,
      coalesce((select sum(s.quantity) from public.inventory_stock s
                join public.inventory_locations l on l.id = s.location_id
                where s.item_id = i.id and s.quantity > 0
                  and (l.kind = 'company' or l.design_project_id = v_dp)), 0)
      - coalesce((select sum(e.composite_qty) from public.job_work_entries e
                  where e.composite_item_id = i.id and not e.billed and e.status = 'active'), 0)
      into v_comp, v_avail
    from public.inventory_items i
    where i.is_composite and i.active
      and exists (select 1 from public.inventory_composite_parts p
                  where p.item_id = i.id and p.role = 'raw' and p.component_item_id = p_raw_material_item_id)
      and (select coalesce(array_agg(p.component_item_id order by p.component_item_id), '{}'::uuid[])
           from public.inventory_composite_parts p where p.item_id = i.id and p.role in ('skin1', 'skin2'))
        = (select coalesce(array_agg(x order by x), '{}'::uuid[])
           from unnest(array[p_skin1_item_id, p_skin2_item_id]) x where x is not null)
    order by 2 desc
    limit 1;
    if v_comp is not null and v_avail > 0 then
      v_c := least(v_avail, p_raw_material_qty);
    else
      v_comp := null;
    end if;
  end if;
  if v_comp is not null then select name into v_cname from public.inventory_items where id = v_comp; end if;

  insert into public.job_work_entries
    (entry_date, project_id, client_id, service_id, rate_category_id, base_quantity, unit_id, remarks, created_by,
     raw_material_item_id, raw_material_qty, skin1_item_id, skin1_qty, skin2_item_id, skin2_qty,
     composite_item_id, composite_qty)
  values
    (p_entry_date, p_project_id, v_project.client_id, p_service_id, v_project.rate_category_id,
     p_base_quantity, v_unit_id,
     case when v_c > 0 then trim(both ' ' from coalesce(p_remarks, '') || ' [' || v_c || ' sheet(s) from composite ' || v_cname || '; only cutting charged for these]') else p_remarks end,
     auth.uid(),
     p_raw_material_item_id, p_raw_material_qty, p_skin1_item_id, p_skin1_qty, p_skin2_item_id, p_skin2_qty,
     case when v_c > 0 then v_comp end, v_c)
  returning id into v_entry_id;

  for v_component in select * from public.compute_service_components(p_service_id, p_base_quantity) loop
    if not (select active from public.job_work_services where id = v_component.component_service_id) then
      raise exception 'Component service % is deactivated and cannot be used.', v_component.component_service_id;
    end if;
    select js.process_id, pr.machine_id, pr.active into v_process_id, v_machine_id, v_process_active
    from public.job_work_services js left join public.processes pr on pr.id = js.process_id
    where js.id = v_component.component_service_id;
    if v_process_id is not null and not coalesce(v_process_active, true) then
      raise exception 'The process behind "%" is deactivated and cannot be used for new entries.',
        (select name from public.job_work_services where id = v_component.component_service_id);
    end if;

    v_is_override := false; v_override_reason := null; v_rate_id := null;
    if p_rate_overrides is not null then
      select o into v_override from jsonb_array_elements(p_rate_overrides) o
      where (o ->> 'component_service_id')::uuid = v_component.component_service_id limit 1;
    end if;

    if v_override is not null then
      v_rate_value := (v_override ->> 'rate')::numeric;
      v_override_reason := v_override ->> 'reason';
      v_is_override := true;
      select rate_id into v_rate_id from public.get_effective_rate(v_component.component_service_id, v_project.rate_category_id, v_unit_id, p_entry_date);
    else
      select rate_id, rate_value into v_rate_id, v_rate_value
      from public.get_effective_rate(v_component.component_service_id, v_project.rate_category_id, v_unit_id, p_entry_date);
      if v_rate_id is null then
        raise exception 'No rate configured for "%" in this rate category and unit as of %.',
          (select name from public.job_work_services where id = v_component.component_service_id), p_entry_date;
      end if;
    end if;

    -- On sheets taken from a composite only Cutting is billed: the rest was billed when it was made.
    v_cq := v_component.component_quantity;
    if v_c > 0 then
      if (select name from public.job_work_services where id = v_component.component_service_id) = 'Cutting' then
        v_cut_done := true;
      else
        v_cq := greatest(v_cq - v_c * v_component.multiplier, 0);
      end if;
    end if;

    v_amount := round(v_cq * v_rate_value, 2);
    v_total := v_total + v_amount;

    insert into public.job_work_entry_components
      (entry_id, component_service_id, process_id, machine_id, multiplier, component_quantity,
       unit_id, rate_id, rate_value, amount, rate_overridden, override_reason, overridden_by, overridden_at)
    values
      (v_entry_id, v_component.component_service_id, v_process_id, v_machine_id, v_component.multiplier,
       v_cq, v_unit_id, v_rate_id, v_rate_value, v_amount,
       v_is_override, v_override_reason, case when v_is_override then auth.uid() end,
       case when v_is_override then now() end);
    v_override := null;
  end loop;

  -- A job work with no Cutting in it still bills Cutting for the sheets taken from a composite.
  if v_c > 0 and not v_cut_done then
    select id into v_cut_id from public.job_work_services where name = 'Cutting' and active;
    if v_cut_id is not null then
      select rate_id, rate_value into v_cut_rate_id, v_cut_rate
      from public.get_effective_rate(v_cut_id, v_project.rate_category_id, v_unit_id, p_entry_date);
      if v_cut_rate_id is not null then
        select js.process_id, pr.machine_id into v_process_id, v_machine_id
        from public.job_work_services js left join public.processes pr on pr.id = js.process_id where js.id = v_cut_id;
        v_amount := round(v_c * v_cut_rate, 2);
        v_total := v_total + v_amount;
        insert into public.job_work_entry_components
          (entry_id, component_service_id, process_id, machine_id, multiplier, component_quantity,
           unit_id, rate_id, rate_value, amount, rate_overridden)
        values (v_entry_id, v_cut_id, v_process_id, v_machine_id, 1, v_c, v_unit_id, v_cut_rate_id, v_cut_rate, v_amount, false);
      end if;
    end if;
  end if;

  update public.job_work_entries set total_amount = v_total where id = v_entry_id;
  perform public.ensure_daily_log(p_entry_date);
  return v_entry_id;
end;
$function$;

-- Billing consumes the composite chosen when the entry was recorded, then the boards and skins for the rest.
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
  v_avail numeric;
  v_used numeric := 0;
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
    if v_entry.composite_item_id is not null and coalesce(v_entry.composite_qty, 0) > 0 then
      select coalesce(sum(s.quantity), 0) into v_avail
      from public.inventory_stock s join public.inventory_locations l on l.id = s.location_id
      where s.item_id = v_entry.composite_item_id and s.quantity > 0
        and (l.kind = 'company' or l.design_project_id = v_design_project_id);
      v_used := least(v_avail, v_entry.composite_qty);
      if v_used > 0 then
        perform public.record_inventory_consumption(
          v_entry.composite_item_id, v_design_project_id, v_used, v_entry.entry_date,
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
