-- Job-work / service master.
--
-- A "process" (0003) is the physical machine operation. A "job-work service" here is the
-- BILLABLE unit. Atomic services (is_composite = false) map 1:1 to a process and carry their
-- own rate in the rates table (0006). Composite services (is_composite = true, e.g. "Double
-- Side Cutting") have no rate of their own -- their amount is the sum of their component atomic
-- services' quantity x rate, per job_work_components. This lets admins build new combinations
-- (section 6/42 of the spec) purely through data, with zero code changes.

create table public.job_work_services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit_id uuid not null references public.units(id),
  process_id uuid references public.processes(id),
  is_composite boolean not null default false,
  active boolean not null default true,
  description text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint chk_composite_has_no_process
    check (not (is_composite and process_id is not null))
);
create index idx_services_process on public.job_work_services(process_id);
create trigger trg_services_updated_at before update on public.job_work_services
  for each row execute function public.set_updated_at();

create table public.job_work_components (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.job_work_services(id) on delete cascade,
  component_service_id uuid not null references public.job_work_services(id),
  multiplier numeric(10,4) not null default 1 check (multiplier > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_component_not_self check (service_id <> component_service_id),
  unique (service_id, component_service_id)
);
create index idx_components_service on public.job_work_components(service_id);

-- Keep the calculation engine single-level: a composite service's components must themselves
-- be atomic (rate-bearing) services. This mirrors every example in the spec and keeps
-- compute_service_components() (0012) simple and predictable for admins building combinations.
create or replace function public.prevent_nested_composite_component()
returns trigger
language plpgsql
as $$
declare
  v_component_is_composite boolean;
  v_service_is_composite boolean;
begin
  select is_composite into v_component_is_composite
  from public.job_work_services where id = new.component_service_id;

  select is_composite into v_service_is_composite
  from public.job_work_services where id = new.service_id;

  if v_component_is_composite then
    raise exception 'Component "%" is itself a composite service; components must be atomic (rate-bearing) services.', new.component_service_id;
  end if;

  if not v_service_is_composite then
    raise exception 'Service % is not marked is_composite = true; only composite services may have components.', new.service_id;
  end if;

  return new;
end;
$$;

create trigger trg_prevent_nested_composite
  before insert or update on public.job_work_components
  for each row execute function public.prevent_nested_composite_component();
