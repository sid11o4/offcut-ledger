-- Internal Order bridge (business context, Oct 2026): when Formgrid Design Build routes panel
-- processing through Formgrid Factory, it's billed under the existing INTERNAL rate category
-- ("Internal Order"). Per the owner's spec: billing for Internal Order entries should capture
-- Raw Material, Skin 1 and Skin 2 (double-side lamination), and that quantity should be added
-- to the linked Design Build project's consumption -- automatically, at the moment the entry
-- is billed (not at daily-log time, since the material is usually confirmed at billing).
--
-- Columns are added directly to job_work_entries (nullable; only ever populated for entries
-- whose project uses the INTERNAL rate category) rather than a side table, since the material
-- used is an attribute of the entry itself, the same way remarks already is.

alter table public.job_work_entries
  add column raw_material_item_id uuid references public.inventory_items(id),
  add column raw_material_qty numeric(14,4),
  add column skin1_item_id uuid references public.inventory_items(id),
  add column skin1_qty numeric(14,4),
  add column skin2_item_id uuid references public.inventory_items(id),
  add column skin2_qty numeric(14,4);

-- Extends bill_items_after_insert() (0009) with the material-consumption posting. Everything
-- from the original function is unchanged; this only adds a final step that fires only when
-- the billed entry has a linked design project and at least one material field set.
create or replace function public.bill_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billed boolean;
  v_status text;
  v_entry record;
  v_design_project_id uuid;
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
    if v_entry.raw_material_item_id is not null and coalesce(v_entry.raw_material_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.raw_material_item_id, v_design_project_id, v_entry.raw_material_qty, v_entry.entry_date,
        'internal_order', new.id, 'Raw material for Internal Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin1_item_id is not null and coalesce(v_entry.skin1_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin1_item_id, v_design_project_id, v_entry.skin1_qty, v_entry.entry_date,
        'internal_order', new.id, 'Skin 1 (lamination) for Internal Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin2_item_id is not null and coalesce(v_entry.skin2_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin2_item_id, v_design_project_id, v_entry.skin2_qty, v_entry.entry_date,
        'internal_order', new.id, 'Skin 2 (double-side lamination) for Internal Order job-work, billed ' || new.id);
    end if;
  end if;

  return new;
end;
$$;

-- record_job_work_entry gains six optional material params so the Daily Log / billing UI can
-- capture Raw Material, Skin 1 and Skin 2 at entry time for Internal Order work (consumption
-- itself is posted later, at billing, by the trigger above -- this just stores what was used).
-- Identical to the current live version otherwise.
drop function if exists public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb, uuid);
create function public.record_job_work_entry(
  p_entry_date date, p_project_id uuid, p_service_id uuid, p_base_quantity numeric,
  p_remarks text default null, p_rate_overrides jsonb default null, p_unit_id uuid default null,
  p_raw_material_item_id uuid default null, p_raw_material_qty numeric default null,
  p_skin1_item_id uuid default null, p_skin1_qty numeric default null,
  p_skin2_item_id uuid default null, p_skin2_qty numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record; v_service record; v_unit_id uuid; v_entry_id uuid; v_component record;
  v_override jsonb; v_rate_id uuid; v_rate_value numeric; v_is_override boolean;
  v_override_reason text; v_amount numeric; v_total numeric := 0;
  v_process_id uuid; v_process_active boolean; v_machine_id uuid;
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

  insert into public.job_work_entries
    (entry_date, project_id, client_id, service_id, rate_category_id, base_quantity, unit_id, remarks, created_by,
     raw_material_item_id, raw_material_qty, skin1_item_id, skin1_qty, skin2_item_id, skin2_qty)
  values
    (p_entry_date, p_project_id, v_project.client_id, p_service_id, v_project.rate_category_id,
     p_base_quantity, v_unit_id, p_remarks, auth.uid(),
     p_raw_material_item_id, p_raw_material_qty, p_skin1_item_id, p_skin1_qty, p_skin2_item_id, p_skin2_qty)
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

    v_amount := round(v_component.component_quantity * v_rate_value, 2);
    v_total := v_total + v_amount;

    insert into public.job_work_entry_components
      (entry_id, component_service_id, process_id, machine_id, multiplier, component_quantity,
       unit_id, rate_id, rate_value, amount, rate_overridden, override_reason, overridden_by, overridden_at)
    values
      (v_entry_id, v_component.component_service_id, v_process_id, v_machine_id, v_component.multiplier,
       v_component.component_quantity, v_unit_id, v_rate_id, v_rate_value, v_amount,
       v_is_override, v_override_reason, case when v_is_override then auth.uid() end,
       case when v_is_override then now() end);
    v_override := null;
  end loop;

  update public.job_work_entries set total_amount = v_total where id = v_entry_id;
  perform public.ensure_daily_log(p_entry_date);
  return v_entry_id;
end;
$$;

grant execute on function
  public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb, uuid, uuid, numeric, uuid, numeric, uuid, numeric)
to authenticated;
