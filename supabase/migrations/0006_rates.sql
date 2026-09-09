-- Rate master with effective-dated versioning (spec section 10).
--
-- Rates are keyed by (job_work_service, rate_category) and only apply to ATOMIC services --
-- composite services derive their amount from their components' rates (see 0005/0012).
--
-- Workflow supported: insert a new rate row with effective_from = the date the new price
-- starts. If an open-ended rate already exists for that (service, category), it is
-- automatically closed to end the day before the new rate starts -- exactly the
-- "5.00 until 30-09, 5.50 from 01-10" example in the spec. Historical job-work entries always
-- store the rate actually used at the time (0007), so changing rates never rewrites history.

create table public.rates (
  id uuid primary key default gen_random_uuid(),
  job_work_service_id uuid not null references public.job_work_services(id),
  rate_category_id uuid not null references public.rate_categories(id),
  rate numeric(12,4) not null check (rate >= 0),
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint chk_rate_date_order check (effective_to is null or effective_to >= effective_from)
);
create index idx_rates_lookup on public.rates(job_work_service_id, rate_category_id, effective_from);

create or replace function public.rates_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_row public.rates%rowtype;
  v_overlap_count int;
begin
  if (select is_composite from public.job_work_services where id = new.job_work_service_id) then
    raise exception 'Rates cannot be set on composite services; set rates on their atomic components instead.';
  end if;

  -- Close the currently open-ended rate for this (service, category), if any.
  select * into v_open_row
  from public.rates
  where job_work_service_id = new.job_work_service_id
    and rate_category_id = new.rate_category_id
    and effective_to is null
  for update;

  if found then
    if new.effective_from <= v_open_row.effective_from then
      raise exception
        'New rate must start after the current rate''s effective_from (%). To correct a past rate, edit that historical row directly via an admin data fix, not by inserting a new version.',
        v_open_row.effective_from;
    end if;
    update public.rates
      set effective_to = new.effective_from - 1
      where id = v_open_row.id;
  end if;

  -- Guard against any remaining overlap (e.g. inserting into a closed gap that collides).
  select count(*) into v_overlap_count
  from public.rates
  where job_work_service_id = new.job_work_service_id
    and rate_category_id = new.rate_category_id
    and id is distinct from new.id
    and new.effective_from <= coalesce(effective_to, 'infinity'::date)
    and coalesce(new.effective_to, 'infinity'::date) >= effective_from;

  if v_overlap_count > 0 then
    raise exception 'Rate date range overlaps an existing rate for this service and rate category.';
  end if;

  return new;
end;
$$;

create trigger trg_rates_before_insert
  before insert on public.rates
  for each row execute function public.rates_before_insert();

create or replace function public.get_effective_rate(
  p_service_id uuid,
  p_rate_category_id uuid,
  p_as_of date
)
returns table (rate_id uuid, rate_value numeric)
language sql
stable
as $$
  select id, rate
  from public.rates
  where job_work_service_id = p_service_id
    and rate_category_id = p_rate_category_id
    and effective_from <= p_as_of
    and (effective_to is null or effective_to >= p_as_of)
  limit 1;
$$;
