-- Expenses (daily + the separate Expenses module -- same table, see spec section 27) and
-- Recurring/Fixed Expenses (spec sections 29-32).

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(12,2) not null check (amount >= 0),
  frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly','custom')),
  start_date date not null,
  end_date date,
  -- Interpretation depends on frequency: monthly/quarterly/yearly = day-of-period (1-based,
  -- clamped to the period's last day); weekly = ISO weekday (1=Mon..7=Sun). Defaults to 1.
  due_day int not null default 1 check (due_day between 1 and 31),
  custom_interval_days int check (custom_interval_days > 0),
  active boolean not null default true,
  notes text,
  reference_number text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint chk_custom_needs_interval
    check (frequency <> 'custom' or custom_interval_days is not null),
  constraint chk_recurring_date_order check (end_date is null or end_date >= start_date)
);
create trigger trg_recurring_expenses_updated_at before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(12,2) not null check (amount >= 0),
  description text,
  project_id uuid references public.projects(id),
  payment_reference text,
  notes text,
  source text not null default 'manual' check (source in ('manual','recurring')),
  recurring_expense_id uuid references public.recurring_expenses(id),
  recurring_period_key text,
  status text not null default 'active' check (status in ('active','void')),
  -- Nullable: recurring-generated rows (source = 'recurring') are system-authored and leave
  -- this null rather than being falsely attributed to whichever staff member happened to
  -- trigger sync_recurring_expenses() by opening a report.
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  constraint chk_recurring_fields
    check (source = 'manual' or (recurring_expense_id is not null and recurring_period_key is not null))
);
create index idx_expenses_date on public.expenses(expense_date);
create index idx_expenses_project on public.expenses(project_id);
create index idx_expenses_category on public.expenses(category_id);
-- One generated instance per recurring expense per period, ever -- this is what makes
-- sync_recurring_expenses() safely re-runnable / idempotent.
create unique index uq_expenses_recurring_period
  on public.expenses(recurring_expense_id, recurring_period_key)
  where recurring_expense_id is not null;
create trigger trg_expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

create or replace function public.check_project_not_cancelled()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if new.project_id is not null then
    select status into v_status from public.projects where id = new.project_id;
    if v_status = 'cancelled' then
      raise exception 'Project is cancelled; reopen it before recording new expenses against it.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_expenses_check_project
  before insert or update on public.expenses
  for each row execute function public.check_project_not_cancelled();

-- Recurring expense instance generation (spec section 32). Documented accounting rule: a
-- recurring expense is recognized exactly once per its frequency cycle, on that cycle's due
-- date, when that due date falls on or before the as_of date passed in. A report for a partial
-- period (e.g. 15 Sep - 30 Sep) therefore includes a recurring expense only if its due date
-- falls inside that exact window -- no proration is invented. Idempotent: safe to call
-- repeatedly (e.g. every time the Daily Log or a report is opened).
create or replace function public.sync_recurring_expenses(p_as_of date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_period_start date;
  v_period_end date;
  v_due_date date;
  v_period_key text;
  v_inserted int := 0;
begin
  for r in select * from public.recurring_expenses where active = true and start_date <= p_as_of
  loop
    if r.frequency = 'monthly' then
      for v_period_start in
        select generate_series(date_trunc('month', r.start_date), date_trunc('month', p_as_of), interval '1 month')::date
      loop
        v_period_end := (v_period_start + interval '1 month - 1 day')::date;
        v_due_date := v_period_start + (least(r.due_day, extract(day from v_period_end)::int) - 1);
        v_period_key := to_char(v_period_start, 'YYYY-MM');
        if v_due_date <= p_as_of and v_due_date >= r.start_date
           and (r.end_date is null or v_due_date <= r.end_date) then
          insert into public.expenses
            (expense_date, category_id, amount, description, source, recurring_expense_id, recurring_period_key)
          values
            (v_due_date, r.category_id, r.amount, r.name, 'recurring', r.id, v_period_key)
          on conflict (recurring_expense_id, recurring_period_key) where recurring_expense_id is not null do nothing;
          if found then v_inserted := v_inserted + 1; end if;
        end if;
      end loop;

    elsif r.frequency = 'quarterly' then
      for v_period_start in
        select generate_series(date_trunc('quarter', r.start_date), date_trunc('quarter', p_as_of), interval '3 months')::date
      loop
        v_period_end := (v_period_start + interval '3 months - 1 day')::date;
        v_due_date := v_period_start + (least(r.due_day, extract(day from v_period_end)::int) - 1);
        v_period_key := to_char(v_period_start, 'YYYY') || '-Q' || to_char(v_period_start, 'Q');
        if v_due_date <= p_as_of and v_due_date >= r.start_date
           and (r.end_date is null or v_due_date <= r.end_date) then
          insert into public.expenses
            (expense_date, category_id, amount, description, source, recurring_expense_id, recurring_period_key)
          values
            (v_due_date, r.category_id, r.amount, r.name, 'recurring', r.id, v_period_key)
          on conflict (recurring_expense_id, recurring_period_key) where recurring_expense_id is not null do nothing;
          if found then v_inserted := v_inserted + 1; end if;
        end if;
      end loop;

    elsif r.frequency = 'yearly' then
      for v_period_start in
        select generate_series(date_trunc('year', r.start_date), date_trunc('year', p_as_of), interval '1 year')::date
      loop
        v_period_end := (v_period_start + interval '1 year - 1 day')::date;
        v_due_date := v_period_start + (least(r.due_day, extract(day from v_period_end)::int) - 1);
        v_period_key := to_char(v_period_start, 'YYYY');
        if v_due_date <= p_as_of and v_due_date >= r.start_date
           and (r.end_date is null or v_due_date <= r.end_date) then
          insert into public.expenses
            (expense_date, category_id, amount, description, source, recurring_expense_id, recurring_period_key)
          values
            (v_due_date, r.category_id, r.amount, r.name, 'recurring', r.id, v_period_key)
          on conflict (recurring_expense_id, recurring_period_key) where recurring_expense_id is not null do nothing;
          if found then v_inserted := v_inserted + 1; end if;
        end if;
      end loop;

    elsif r.frequency = 'weekly' then
      for v_period_start in
        select generate_series(date_trunc('week', r.start_date), date_trunc('week', p_as_of), interval '7 days')::date
      loop
        v_due_date := v_period_start + (least(r.due_day, 7) - 1);
        v_period_key := to_char(v_period_start, 'IYYY-"W"IW');
        if v_due_date <= p_as_of and v_due_date >= r.start_date
           and (r.end_date is null or v_due_date <= r.end_date) then
          insert into public.expenses
            (expense_date, category_id, amount, description, source, recurring_expense_id, recurring_period_key)
          values
            (v_due_date, r.category_id, r.amount, r.name, 'recurring', r.id, v_period_key)
          on conflict (recurring_expense_id, recurring_period_key) where recurring_expense_id is not null do nothing;
          if found then v_inserted := v_inserted + 1; end if;
        end if;
      end loop;

    elsif r.frequency = 'custom' then
      v_period_start := r.start_date;
      declare v_n int := 0;
      begin
        while v_period_start <= p_as_of loop
          v_due_date := v_period_start;
          v_period_key := 'C' || v_n;
          if r.end_date is null or v_due_date <= r.end_date then
            insert into public.expenses
              (expense_date, category_id, amount, description, source, recurring_expense_id, recurring_period_key)
            values
              (v_due_date, r.category_id, r.amount, r.name, 'recurring', r.id, v_period_key)
            on conflict (recurring_expense_id, recurring_period_key) where recurring_expense_id is not null do nothing;
            if found then v_inserted := v_inserted + 1; end if;
          end if;
          v_n := v_n + 1;
          v_period_start := v_period_start + r.custom_interval_days;
        end loop;
      end;
    end if;
  end loop;

  return v_inserted;
end;
$$;
