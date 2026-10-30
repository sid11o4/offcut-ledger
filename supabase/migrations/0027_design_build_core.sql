-- Formgrid Design Build integration (business context from the factory owner, Oct 2026):
-- Formgrid Design Build is a sister business under the same parent (Formgrid Interior
-- Solutions) that handles turnkey interior design + execution. Its panel-processing work is
-- routed through Formgrid Factory as job-work billed under the existing INTERNAL rate
-- category ("Internal Order" -- see 0015's seed). This migration adds Design Build's own
-- project ledger plus a supplier master (used by the Accounts/AP system in later migrations),
-- linked back to Factory's existing clients/projects tables rather than duplicating them.

create extension if not exists pg_trgm;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text,
  phone text,
  address text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_suppliers_name_trgm on public.suppliers using gin (name gin_trgm_ops);
create trigger trg_suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.design_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  client_id uuid references public.clients(id),
  -- The Factory-side project used for this Design Build project's Internal Order job-work
  -- billing, if any. Nullable (not every interior project needs factory panel processing) and
  -- unique (a Factory project backs at most one Design Build project, so material-consumption
  -- postings from a billed Internal Order entry are never ambiguous about which project owns them).
  factory_project_id uuid references public.projects(id),
  status text not null default 'active'
    check (status in ('active','on_hold','completed','cancelled')),
  start_date date not null default current_date,
  expected_completion_date date,
  budget numeric(14,2),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create unique index uq_design_projects_factory_project on public.design_projects(factory_project_id)
  where factory_project_id is not null;
create index idx_design_projects_client on public.design_projects(client_id);
create trigger trg_design_projects_updated_at before update on public.design_projects
  for each row execute function public.set_updated_at();
