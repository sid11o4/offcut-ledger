-- Configurable master data: units, machines, processes, rate categories, expense categories.
-- All follow the same soft-deactivation pattern: never hard-deleted once referenced.

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_units_updated_at before update on public.units
  for each row execute function public.set_updated_at();

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_machines_updated_at before update on public.machines
  for each row execute function public.set_updated_at();

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  machine_id uuid not null references public.machines(id),
  description text,
  default_unit_id uuid references public.units(id),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_processes_machine on public.processes(machine_id);
create trigger trg_processes_updated_at before update on public.processes
  for each row execute function public.set_updated_at();

create table public.rate_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_rate_categories_updated_at before update on public.rate_categories
  for each row execute function public.set_updated_at();

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();
