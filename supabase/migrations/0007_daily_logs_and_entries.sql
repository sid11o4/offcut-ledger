-- Daily Log + job-work entries: the operational core (spec sections 13-17, 41-42).
--
-- daily_logs is a thin per-date container (status/notes) auto-provisioned the first time
-- an entry or expense is recorded for a date; job_work_entries/expenses reference the date
-- directly so reporting never needs a join through it. job_work_entry_components stores the
-- fully expanded, priced calculation (one row per underlying atomic service) so machine-wise
-- and process-wise revenue reporting works even for composite services, and so historical
-- amounts never move when masters/rates change later.

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  log_date date not null unique,
  status text not null default 'open' check (status in ('open','locked')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_daily_logs_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();

create or replace function public.ensure_daily_log(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_logs (log_date, created_by)
  values (p_date, auth.uid())
  on conflict (log_date) do nothing;
end;
$$;

create table public.job_work_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  project_id uuid not null references public.projects(id),
  client_id uuid not null references public.clients(id),
  service_id uuid not null references public.job_work_services(id),
  rate_category_id uuid not null references public.rate_categories(id),
  base_quantity numeric(14,4) not null check (base_quantity > 0),
  unit_id uuid not null references public.units(id),
  remarks text,
  status text not null default 'active' check (status in ('active','cancelled')),
  total_amount numeric(14,2) not null default 0,
  billed boolean not null default false,
  bill_item_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_entries_date on public.job_work_entries(entry_date);
create index idx_entries_project on public.job_work_entries(project_id);
create index idx_entries_billed on public.job_work_entries(billed) where status = 'active';
create index idx_entries_service on public.job_work_entries(service_id);
create trigger trg_entries_updated_at before update on public.job_work_entries
  for each row execute function public.set_updated_at();

create table public.job_work_entry_components (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.job_work_entries(id) on delete cascade,
  component_service_id uuid not null references public.job_work_services(id),
  process_id uuid references public.processes(id),
  machine_id uuid references public.machines(id),
  multiplier numeric(10,4) not null default 1,
  component_quantity numeric(14,4) not null,
  unit_id uuid not null references public.units(id),
  rate_id uuid references public.rates(id),
  rate_value numeric(12,4) not null,
  amount numeric(14,2) not null,
  rate_overridden boolean not null default false,
  override_reason text,
  overridden_by uuid references public.profiles(id),
  overridden_at timestamptz
);
create index idx_entry_components_entry on public.job_work_entry_components(entry_id);
create index idx_entry_components_machine on public.job_work_entry_components(machine_id);
create index idx_entry_components_process on public.job_work_entry_components(process_id);

comment on column public.job_work_entries.bill_item_id is
  'FK to bill_items added in 0009_billing.sql once that table exists (billing depends on entries, not the reverse).';
