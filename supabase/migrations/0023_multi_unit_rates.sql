-- Multi-unit rates (requested by the factory owner). Previously a job-work service had ONE
-- unit and one rate line per (service, rate_category, time). Now a service can be priced in
-- several units at once -- e.g. Cutting at a per-Sq.ft rate AND a per-R.ft rate -- and the
-- Daily Log lets staff pick which unit an entry is in (defaulting to the service's unit).
--
-- The rate is now keyed by (service, rate_category, UNIT, time). Effective-dating and the
-- "close the previous open rate" behaviour are unchanged, just scoped per unit. A composite
-- service can be logged in a given unit only if every one of its atomic components has a rate
-- in that unit -- otherwise record_job_work_entry() raises a clear "no rate configured"
-- error, which keeps composite pricing coherent.

-- 1. Add the unit dimension to rates. Backfill existing rows (none on the live DB after the
--    clean-slate wipe; on a from-scratch rebuild, 0016's seed rates take their service's
--    default unit) so the column can be NOT NULL.
alter table public.rates add column unit_id uuid references public.units(id);
update public.rates r set unit_id = s.unit_id
  from public.job_work_services s where s.id = r.job_work_service_id and r.unit_id is null;
alter table public.rates alter column unit_id set not null;
drop index if exists idx_rates_lookup;
create index idx_rates_lookup on public.rates(job_work_service_id, rate_category_id, unit_id, effective_from);

-- 2. Effective-rate lookup now takes a unit.
drop function if exists public.get_effective_rate(uuid, uuid, date);
create function public.get_effective_rate(p_service_id uuid, p_rate_category_id uuid, p_unit_id uuid, p_as_of date)
returns table (rate_id uuid, rate_value numeric)
language sql stable set search_path = public as $$
  select id, rate from public.rates
  where job_work_service_id = p_service_id and rate_category_id = p_rate_category_id
    and unit_id = p_unit_id and effective_from <= p_as_of
    and (effective_to is null or effective_to >= p_as_of)
  limit 1;
$$;

-- 3. The "close the open rate / no overlap" trigger, now scoped per (service, category, unit).
create or replace function public.rates_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open_row public.rates%rowtype;
  v_overlap_count int;
begin
  if (select is_composite from public.job_work_services where id = new.job_work_service_id) then
    raise exception 'Rates cannot be set on composite services; set rates on their atomic components instead.';
  end if;
  select * into v_open_row from public.rates
  where job_work_service_id = new.job_work_service_id and rate_category_id = new.rate_category_id
    and unit_id = new.unit_id and effective_to is null for update;
  if found then
    if new.effective_from <= v_open_row.effective_from then
      raise exception 'New rate must start after the current rate''s effective_from (%). To correct a past rate, edit that historical row directly via an admin data fix, not by inserting a new version.', v_open_row.effective_from;
    end if;
    update public.rates set effective_to = new.effective_from - 1 where id = v_open_row.id;
  end if;
  select count(*) into v_overlap_count from public.rates
  where job_work_service_id = new.job_work_service_id and rate_category_id = new.rate_category_id
    and unit_id = new.unit_id and id is distinct from new.id
    and new.effective_from <= coalesce(effective_to, 'infinity'::date)
    and coalesce(new.effective_to, 'infinity'::date) >= effective_from;
  if v_overlap_count > 0 then
    raise exception 'Rate date range overlaps an existing rate for this service, rate category and unit.';
  end if;
  return new;
end;
$$;

-- 4. record_job_work_entry gains p_unit_id (defaults to the service's own unit). Every
--    component of a composite is then priced in that same unit, so a unit only works for a
--    composite when all its components have a rate in it.
drop function if exists public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb);
create function public.record_job_work_entry(
  p_entry_date date, p_project_id uuid, p_service_id uuid, p_base_quantity numeric,
  p_remarks text default null, p_rate_overrides jsonb default null, p_unit_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
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
    (entry_date, project_id, client_id, service_id, rate_category_id, base_quantity, unit_id, remarks, created_by)
  values
    (p_entry_date, p_project_id, v_project.client_id, p_service_id, v_project.rate_category_id,
     p_base_quantity, v_unit_id, p_remarks, auth.uid())
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

-- 5. Quantity-bearing reports group by the entry's own unit now (summing quantities across
--    different units is meaningless). Revenue figures are unchanged either way. Return type
--    changed, so these are dropped and recreated rather than CREATE OR REPLACEd.
drop function if exists public.report_revenue_by_service(date, date);
create function public.report_revenue_by_service(p_start date, p_end date)
returns table (service_id uuid, service_code text, service_name text, entry_count bigint, total_quantity numeric, unit_code text, revenue numeric)
language sql stable set search_path = public as $$
  select s.id, s.code, s.name, count(e.id), coalesce(sum(e.base_quantity), 0), u.code, coalesce(sum(e.total_amount), 0)
  from public.job_work_services s
  join public.job_work_entries e on e.service_id = s.id and e.status = 'active' and e.entry_date between p_start and p_end
  join public.units u on u.id = e.unit_id
  group by s.id, s.code, s.name, u.code
  order by coalesce(sum(e.total_amount), 0) desc;
$$;

drop function if exists public.report_revenue_by_process(date, date);
create function public.report_revenue_by_process(p_start date, p_end date)
returns table (process_id uuid, process_code text, process_name text, total_quantity numeric, unit_code text, revenue numeric)
language sql stable set search_path = public as $$
  select pr.id, pr.code, pr.name, coalesce(sum(c.component_quantity), 0), u.code, coalesce(sum(c.amount), 0)
  from public.processes pr
  join public.job_work_entry_components c on c.process_id = pr.id
  join public.job_work_entries e on e.id = c.entry_id and e.status = 'active' and e.entry_date between p_start and p_end
  join public.units u on u.id = c.unit_id
  group by pr.id, pr.code, pr.name, u.code
  order by coalesce(sum(c.amount), 0) desc;
$$;

drop function if exists public.report_revenue_by_machine(date, date);
create function public.report_revenue_by_machine(p_start date, p_end date)
returns table (machine_id uuid, machine_code text, machine_name text, total_quantity numeric, unit_code text, revenue numeric)
language sql stable set search_path = public as $$
  select m.id, m.code, m.name, coalesce(sum(c.component_quantity), 0), u.code, coalesce(sum(c.amount), 0)
  from public.machines m
  join public.job_work_entry_components c on c.machine_id = m.id
  join public.job_work_entries e on e.id = c.entry_id and e.status = 'active' and e.entry_date between p_start and p_end
  join public.units u on u.id = c.unit_id
  group by m.id, m.code, m.name, u.code
  order by coalesce(sum(c.amount), 0) desc;
$$;

-- 6. Re-grant EXECUTE on the recreated functions (0017 revoked it from PUBLIC/anon and
--    granted it only to `authenticated` on the RPC surface; drop+recreate loses that grant).
grant execute on function
  public.get_effective_rate(uuid, uuid, uuid, date),
  public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb, uuid),
  public.report_revenue_by_service(date, date),
  public.report_revenue_by_process(date, date),
  public.report_revenue_by_machine(date, date)
to authenticated;
