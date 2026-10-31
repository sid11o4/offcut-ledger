-- Design Build's own recurring / fixed expenses (rent, EMI, salaries for the Design Build company or
-- one of its projects). Same rules as the Factory recurring expenses in 0010, but generated into
-- design_build_expenses, so Factory's recurring list and Factory's expenses never see them.

create table if not exists public.design_build_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(14,2) not null check (amount >= 0),
  frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly','custom')),
  start_date date not null,
  end_date date,
  due_day int not null default 1 check (due_day between 1 and 31),
  custom_interval_days int check (custom_interval_days > 0),
  design_project_id uuid references public.design_projects(id),
  active boolean not null default true,
  notes text,
  reference_number text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint chk_db_custom_needs_interval
    check (frequency <> 'custom' or custom_interval_days is not null),
  constraint chk_db_recurring_date_order check (end_date is null or end_date >= start_date)
);
create trigger trg_db_recurring_expenses_updated_at before update on public.design_build_recurring_expenses
  for each row execute function public.set_updated_at();

alter table public.design_build_recurring_expenses enable row level security;

create policy db_recurring_select on public.design_build_recurring_expenses for select
  using (public.has_permission('design_build_manage') or public.has_permission('financial_reports'));
create policy db_recurring_insert on public.design_build_recurring_expenses for insert
  with check (public.has_permission('design_build_manage'));
create policy db_recurring_update on public.design_build_recurring_expenses for update
  using (public.has_permission('design_build_manage'));

create trigger trg_audit_db_recurring_expenses
  after insert or update or delete on public.design_build_recurring_expenses
  for each row execute function public.audit_row_change();

-- Link generated rows back to their recurring template, as the Factory expenses table does.
alter table public.design_build_expenses
  add column if not exists source text not null default 'manual' check (source in ('manual', 'recurring')),
  add column if not exists recurring_design_expense_id uuid references public.design_build_recurring_expenses(id),
  add column if not exists recurring_period_key text;

alter table public.design_build_expenses
  drop constraint if exists chk_db_recurring_fields;
alter table public.design_build_expenses
  add constraint chk_db_recurring_fields
    check (source = 'manual' or (recurring_design_expense_id is not null and recurring_period_key is not null));

create unique index if not exists uq_db_expenses_recurring_period
  on public.design_build_expenses (recurring_design_expense_id, recurring_period_key)
  where recurring_design_expense_id is not null;

-- Due instances of one recurring template up to p_as_of. Mirrors the Factory rules: monthly, quarterly
-- and yearly use day-of-period clamped to the period end; weekly uses ISO weekday; custom steps by N days.
create or replace function public.design_recurring_instances(r public.design_build_recurring_expenses, p_as_of date)
returns table(due_on date, period_key text)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_ps date;
  v_pe date;
  v_due date;
  v_n int := 0;
begin
  if r.frequency = 'monthly' then
    for v_ps in select generate_series(date_trunc('month', r.start_date), date_trunc('month', p_as_of), interval '1 month')::date loop
      v_pe := (v_ps + interval '1 month - 1 day')::date;
      v_due := v_ps + (least(r.due_day, extract(day from v_pe)::int) - 1);
      if v_due <= p_as_of and v_due >= r.start_date and (r.end_date is null or v_due <= r.end_date) then
        due_on := v_due; period_key := to_char(v_ps, 'YYYY-MM'); return next;
      end if;
    end loop;
  elsif r.frequency = 'quarterly' then
    for v_ps in select generate_series(date_trunc('quarter', r.start_date), date_trunc('quarter', p_as_of), interval '3 months')::date loop
      v_pe := (v_ps + interval '3 months - 1 day')::date;
      v_due := v_ps + (least(r.due_day, extract(day from v_pe)::int) - 1);
      if v_due <= p_as_of and v_due >= r.start_date and (r.end_date is null or v_due <= r.end_date) then
        due_on := v_due; period_key := to_char(v_ps, 'YYYY') || '-Q' || to_char(v_ps, 'Q'); return next;
      end if;
    end loop;
  elsif r.frequency = 'yearly' then
    for v_ps in select generate_series(date_trunc('year', r.start_date), date_trunc('year', p_as_of), interval '1 year')::date loop
      v_pe := (v_ps + interval '1 year - 1 day')::date;
      v_due := v_ps + (least(r.due_day, extract(day from v_pe)::int) - 1);
      if v_due <= p_as_of and v_due >= r.start_date and (r.end_date is null or v_due <= r.end_date) then
        due_on := v_due; period_key := to_char(v_ps, 'YYYY'); return next;
      end if;
    end loop;
  elsif r.frequency = 'weekly' then
    for v_ps in select generate_series(date_trunc('week', r.start_date), date_trunc('week', p_as_of), interval '7 days')::date loop
      v_due := v_ps + (least(r.due_day, 7) - 1);
      if v_due <= p_as_of and v_due >= r.start_date and (r.end_date is null or v_due <= r.end_date) then
        due_on := v_due; period_key := to_char(v_ps, 'IYYY-"W"IW'); return next;
      end if;
    end loop;
  elsif r.frequency = 'custom' then
    v_ps := r.start_date;
    while v_ps <= p_as_of loop
      if r.end_date is null or v_ps <= r.end_date then
        due_on := v_ps; period_key := 'C' || v_n; return next;
      end if;
      v_n := v_n + 1;
      v_ps := v_ps + r.custom_interval_days;
    end loop;
  end if;
end;
$$;

-- Generates every due Design Build recurring instance up to p_as_of. Idempotent through the unique index.
create or replace function public.sync_design_build_recurring_expenses(p_as_of date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  insert into public.design_build_expenses
    (expense_date, category_id, amount, description, design_project_id, source, recurring_design_expense_id, recurring_period_key)
  select i.due_on, r.category_id, r.amount, r.name, r.design_project_id, 'recurring', r.id, i.period_key
  from public.design_build_recurring_expenses r
  cross join lateral public.design_recurring_instances(r, p_as_of) i
  where r.active and r.start_date <= p_as_of
  on conflict (recurring_design_expense_id, recurring_period_key) where recurring_design_expense_id is not null do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.design_recurring_instances(public.design_build_recurring_expenses, date) from public, anon, authenticated;
revoke execute on function public.sync_design_build_recurring_expenses(date) from public, anon;
grant execute on function public.sync_design_build_recurring_expenses(date) to authenticated;
