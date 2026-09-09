-- The calculation engine (spec section 42) and the transactional RPCs that are the only
-- sanctioned way to create job-work entries and bills. Most are SECURITY INVOKER: they run
-- with the calling user's own privileges, so normal table RLS (0014) is still the real
-- authorization boundary -- they just orchestrate multiple inserts atomically and apply
-- business rules a bare INSERT can't express. record_job_work_entry is the one exception
-- (SECURITY DEFINER, explained at its definition) because its own UPDATE of total_amount
-- would otherwise require the 'historical_edit' permission that ordinary logging staff --
-- the function's primary caller -- don't hold.

-- Expands a service into its priced, atomic components. An atomic service expands to a
-- single "component" of itself (multiplier 1) so callers never need to special-case
-- composite vs atomic.
create or replace function public.compute_service_components(p_service_id uuid, p_base_quantity numeric)
returns table (component_service_id uuid, multiplier numeric, component_quantity numeric)
language sql
stable
as $$
  select p_service_id, 1::numeric, p_base_quantity
  where not (select is_composite from public.job_work_services where id = p_service_id)
  union all
  select c.component_service_id, c.multiplier, p_base_quantity * c.multiplier
  from public.job_work_components c
  where c.service_id = p_service_id
    and (select is_composite from public.job_work_services where id = p_service_id);
$$;

-- p_rate_overrides: optional jsonb array of {"component_service_id": uuid, "rate": numeric, "reason": text}
-- Only usable by callers holding the rate_override permission; enforced here, not just in the UI.
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
  v_machine_id uuid;
begin
  -- SECURITY DEFINER (see below for why) means the normal RLS "is_active_user()" insert gate
  -- is bypassed, so it's re-asserted explicitly here.
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

    select js.process_id, pr.machine_id into v_process_id, v_machine_id
    from public.job_work_services js
    left join public.processes pr on pr.id = js.process_id
    where js.id = v_component.component_service_id;

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

create or replace function public.cancel_job_work_entry(p_entry_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_billed boolean;
begin
  select billed into v_billed from public.job_work_entries where id = p_entry_id;
  if v_billed then
    raise exception 'Cannot cancel a job-work entry that has already been billed; cancel the bill first.';
  end if;
  if not public.has_permission('historical_edit') then
    raise exception 'You do not have permission to cancel job-work entries.';
  end if;

  update public.job_work_entries
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_entry_id and status = 'active';
end;
$$;

-- Generates a bill from a specific set of active, unbilled entries belonging to one project.
-- Atomically locks + flips each entry to billed via the bill_items trigger (0009), so this is
-- also the codified defence against double-billing under concurrent use.
create or replace function public.generate_bill(
  p_project_id uuid,
  p_entry_ids uuid[],
  p_billing_period_start date default null,
  p_billing_period_end date default null,
  p_tax_percent numeric default 0,
  p_adjustments numeric default 0,
  p_adjustment_notes text default null,
  p_notes text default null
)
returns uuid
language plpgsql
as $$
declare
  v_client_id uuid;
  v_bill_id uuid;
  v_subtotal numeric := 0;
  v_tax numeric;
  v_bad_count int;
begin
  if not public.has_permission('billing') then
    raise exception 'You do not have permission to generate bills.';
  end if;
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    raise exception 'Select at least one job-work entry to bill.';
  end if;

  select count(*) into v_bad_count
  from public.job_work_entries
  where id = any(p_entry_ids)
    and (project_id <> p_project_id or status <> 'active' or billed);
  if v_bad_count > 0 then
    raise exception 'One or more selected entries are not eligible for billing (wrong project, cancelled, or already billed).';
  end if;

  select client_id into v_client_id from public.projects where id = p_project_id;

  select coalesce(sum(total_amount), 0) into v_subtotal
  from public.job_work_entries where id = any(p_entry_ids);

  v_tax := round(v_subtotal * coalesce(p_tax_percent, 0) / 100, 2);

  insert into public.bills
    (client_id, project_id, billing_period_start, billing_period_end, status,
     subtotal, tax_percent, tax_amount, adjustments, adjustment_notes, grand_total, notes, created_by)
  values
    (v_client_id, p_project_id, p_billing_period_start, p_billing_period_end, 'issued',
     v_subtotal, coalesce(p_tax_percent, 0), v_tax, coalesce(p_adjustments, 0), p_adjustment_notes,
     v_subtotal + v_tax + coalesce(p_adjustments, 0), p_notes, auth.uid())
  returning id into v_bill_id;

  insert into public.bill_items (bill_id, job_work_entry_id, service_id, entry_date, quantity, unit_id, amount)
  select v_bill_id, e.id, e.service_id, e.entry_date, e.base_quantity, e.unit_id, e.total_amount
  from public.job_work_entries e
  where e.id = any(p_entry_ids);

  return v_bill_id;
end;
$$;

create or replace function public.cancel_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  if not public.has_permission('bill_cancel') then
    raise exception 'You do not have permission to cancel bills.';
  end if;
  update public.bills
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_bill_id and status <> 'cancelled';
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  if not public.has_permission('expense_manage') then
    raise exception 'You do not have permission to void expenses.';
  end if;
  update public.expenses
    set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
    where id = p_expense_id and status = 'active';
end;
$$;
