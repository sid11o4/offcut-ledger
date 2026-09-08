-- Job-work estimates (spec sections 20-21).

create sequence public.estimate_number_seq;

create or replace function public.next_estimate_number()
returns text
language sql
as $$
  select 'EST-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.estimate_number_seq')::text, 5, '0');
$$;

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text not null unique default public.next_estimate_number(),
  estimate_date date not null default current_date,
  client_id uuid not null references public.clients(id),
  project_id uuid references public.projects(id),
  rate_category_id uuid not null references public.rate_categories(id),
  status text not null default 'draft'
    check (status in ('draft','issued','accepted','rejected','expired','cancelled')),
  validity_date date,
  subtotal numeric(14,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_estimates_project on public.estimates(project_id);
create index idx_estimates_client on public.estimates(client_id);
create trigger trg_estimates_updated_at before update on public.estimates
  for each row execute function public.set_updated_at();

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  service_id uuid not null references public.job_work_services(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_id uuid not null references public.units(id),
  rate numeric(12,4) not null check (rate >= 0),
  amount numeric(14,2) not null,
  sort_order int not null default 0
);
create index idx_estimate_items_estimate on public.estimate_items(estimate_id);

-- Keep estimate header totals in sync with its line items whenever items change.
create or replace function public.recalc_estimate_totals(p_estimate_id uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(14,2);
  v_tax_percent numeric(5,2);
begin
  select coalesce(sum(amount), 0) into v_subtotal
  from public.estimate_items where estimate_id = p_estimate_id;

  select tax_percent into v_tax_percent from public.estimates where id = p_estimate_id;

  update public.estimates
    set subtotal = v_subtotal,
        tax_amount = round(v_subtotal * coalesce(v_tax_percent, 0) / 100, 2),
        grand_total = v_subtotal + round(v_subtotal * coalesce(v_tax_percent, 0) / 100, 2)
    where id = p_estimate_id;
end;
$$;

create or replace function public.estimate_items_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_estimate_totals(coalesce(new.estimate_id, old.estimate_id));
  return null;
end;
$$;

create trigger trg_estimate_items_changed
  after insert or update or delete on public.estimate_items
  for each row execute function public.estimate_items_changed();

-- Recalc is also needed when tax_percent changes directly on the header (not just when line
-- items change). The WHEN clause means the nested UPDATE this fires (which only touches
-- subtotal/tax_amount/grand_total, never tax_percent) cannot re-trigger itself.
create or replace function public.estimate_tax_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_estimate_totals(new.id);
  return null;
end;
$$;

create trigger trg_estimate_tax_changed
  after update of tax_percent on public.estimates
  for each row
  when (old.tax_percent is distinct from new.tax_percent)
  execute function public.estimate_tax_changed();
