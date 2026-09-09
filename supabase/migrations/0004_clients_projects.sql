-- Clients and Projects.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  gst_number text,
  default_rate_category_id uuid references public.rate_categories(id),
  active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  client_id uuid not null references public.clients(id),
  rate_category_id uuid not null references public.rate_categories(id),
  start_date date not null default current_date,
  expected_completion_date date,
  status text not null default 'draft'
    check (status in ('draft','active','on_hold','completed','closed','cancelled')),
  notes text,
  billing_info jsonb not null default '{}'::jsonb,
  tax_info jsonb not null default '{"tax_percent": 0, "tax_inclusive": false}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_projects_client on public.projects(client_id);
create index idx_projects_status on public.projects(status);
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

comment on column public.projects.rate_category_id is
  'Defaults from the client at creation time but can be overridden per-project; stored explicitly so history is stable even if the client default later changes.';
