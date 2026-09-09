-- Closes a real integrity/security gap found on full spec re-review (sections 22/39/56):
-- "A job-work entry cannot be billed twice", "Deactivated processes cannot be used for new
-- transactions", "Never rely on UI hiding to enforce permissions" -- record_job_work_entry()
-- (0012) is documented as the sole sanctioned way to create job-work entries, and it is
-- SECURITY DEFINER precisely so it can enforce active-service checks, rate lookup, and
-- override permissions before writing. But the original RLS policies on job_work_entries and
-- job_work_entry_components (0014) allowed ANY active authenticated user to INSERT directly
-- into both tables via the REST API (`with check (public.is_active_user() ...)`), completely
-- bypassing that function -- a caller could fabricate an entry with an arbitrary total_amount,
-- set billed = true from creation (skipping bill_items entirely), or insert component rows
-- that corrupt machine/process-wise reporting, all without ever touching the calculation
-- engine's guarantees. The frontend never inserts into either table directly (verified via
-- grep across src/ -- every write goes through the record_job_work_entry RPC), so there is no
-- legitimate use case for a direct INSERT to protect. record_job_work_entry() itself is
-- unaffected: as a SECURITY DEFINER function owned by the same role that owns these tables, it
-- bypasses RLS the same way the table owner always does (this is exactly why the function
-- exists per the comment in 0012 -- otherwise its own UPDATE of total_amount would require
-- historical_edit).

drop policy job_work_entries_insert on public.job_work_entries;
create policy job_work_entries_insert on public.job_work_entries
  for insert with check (false);
comment on policy job_work_entries_insert on public.job_work_entries is
  'No direct inserts. The only sanctioned writer is record_job_work_entry(), which bypasses RLS as the owning role.';

drop policy job_work_entry_components_insert on public.job_work_entry_components;
create policy job_work_entry_components_insert on public.job_work_entry_components
  for insert with check (false);
comment on policy job_work_entry_components_insert on public.job_work_entry_components is
  'No direct inserts. The only sanctioned writer is record_job_work_entry(), which bypasses RLS as the owning role.';

-- Secondary gap in the same area (spec section 39: "Deactivated processes cannot be used for
-- new transactions"): record_job_work_entry checked that each component SERVICE was active,
-- but not that its underlying PROCESS was still active. An admin who deactivates a process
-- without also deactivating every service built on it could still have new work logged
-- against that process. Re-created with the added check (identical otherwise).
create or replace function public.record_job_work_entry(
  p_entry_date date,
  p_project_id uuid,
  p_service_id uuid,
  p_base_quantity numeric,
  p_remarks text default null,
  p_rate_overrides jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record;
  v_service record;
  v_entry_id uuid;
  v_component record;
  v_override jsonb;
  v_rate_id uuid;
  v_rate_value numeric;
  v_is_override boolean;
  v_override_reason text;
  v_amount numeric;
  v_total numeric := 0;
  v_process_id uuid;
  v_process_active boolean;
  v_machine_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'Your account is inactive.';
  end if;

  if p_base_quantity is null or p_base_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  select id, client_id, rate_category_id, status into v_project
  from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found.';
  end if;
  if v_project.status = 'cancelled' then
    raise exception 'Project is cancelled; reopen it before recording new work against it.';
  end if;

  select id, unit_id, active into v_service from public.job_work_services where id = p_service_id;
  if v_service.id is null then
    raise exception 'Job-work service not found.';
  end if;
  if not v_service.active then
    raise exception 'This job-work service is deactivated and cannot be used for new entries.';
  end if;

  if p_rate_overrides is not null and jsonb_array_length(p_rate_overrides) > 0
     and not public.has_permission('rate_override') then
    raise exception 'You do not have permission to override rates.';
  end if;

  insert into public.job_work_entries
    (entry_date, project_id, client_id, service_id, rate_category_id, base_quantity, unit_id, remarks, created_by)
  values
    (p_entry_date, p_project_id, v_project.client_id, p_service_id, v_project.rate_category_id,
     p_base_quantity, v_service.unit_id, p_remarks, auth.uid())
  returning id into v_entry_id;

  for v_component in
    select * from public.compute_service_components(p_service_id, p_base_quantity)
  loop
    if not (select active from public.job_work_services where id = v_component.component_service_id) then
      raise exception 'Component service % is deactivated and cannot be used.', v_component.component_service_id;
    end if;

    select js.process_id, pr.machine_id, pr.active into v_process_id, v_machine_id, v_process_active
    from public.job_work_services js
    left join public.processes pr on pr.id = js.process_id
    where js.id = v_component.component_service_id;

    if v_process_id is not null and not coalesce(v_process_active, true) then
      raise exception 'The process behind "%" is deactivated and cannot be used for new entries.',
        (select name from public.job_work_services where id = v_component.component_service_id);
    end if;

    v_is_override := false;
    v_override_reason := null;
    v_rate_id := null;

    if p_rate_overrides is not null then
      select o into v_override
      from jsonb_array_elements(p_rate_overrides) o
      where (o ->> 'component_service_id')::uuid = v_component.component_service_id
      limit 1;
    end if;

    if v_override is not null then
      v_rate_value := (v_override ->> 'rate')::numeric;
      v_override_reason := v_override ->> 'reason';
      v_is_override := true;
      select rate_id into v_rate_id
      from public.get_effective_rate(v_component.component_service_id, v_project.rate_category_id, p_entry_date);
    else
      select rate_id, rate_value into v_rate_id, v_rate_value
      from public.get_effective_rate(v_component.component_service_id, v_project.rate_category_id, p_entry_date);

      if v_rate_id is null then
        raise exception 'No rate configured for "%" in this rate category as of %.',
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
       v_component.component_quantity, v_service.unit_id, v_rate_id, v_rate_value, v_amount,
       v_is_override, v_override_reason, case when v_is_override then auth.uid() end,
       case when v_is_override then now() end);

    v_override := null;
  end loop;

  update public.job_work_entries set total_amount = v_total where id = v_entry_id;
  perform public.ensure_daily_log(p_entry_date);

  return v_entry_id;
end;
$$;

alter function public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb) set search_path = public;
