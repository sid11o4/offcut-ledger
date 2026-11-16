-- Labour: contractors and masons, and their shifts. Each labour entry is also written to the
-- expense ledger (Factory expenses or Design Build expenses) under the Labour category, so totals,
-- statements and reports stay in step. Voiding an entry voids its expense too.

create table if not exists public.labour_contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null default 'Contractor' check (role in ('Contractor', 'Mason')),
  phone text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.labour_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  contractor_id uuid not null references public.labour_contractors(id),
  side text not null check (side in ('factory', 'design_build')),
  project_id uuid references public.projects(id),
  design_project_id uuid references public.design_projects(id),
  shifts numeric(8,2) not null check (shifts > 0),
  rate_per_shift numeric(12,2) not null check (rate_per_shift >= 0),
  amount numeric(14,2) generated always as (round(shifts * rate_per_shift, 2)) stored,
  expense_id uuid,
  notes text,
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check ((side = 'factory' and design_project_id is null) or (side = 'design_build' and project_id is null))
);

create index if not exists idx_labour_entries_contractor on public.labour_entries(contractor_id, entry_date);

alter table public.labour_contractors enable row level security;
alter table public.labour_entries enable row level security;

create policy labour_contractors_read on public.labour_contractors for select to authenticated
  using (has_permission('expense_manage') or has_permission('design_build_manage') or has_permission('financial_reports'));
create policy labour_entries_read on public.labour_entries for select to authenticated
  using (has_permission('expense_manage') or has_permission('design_build_manage') or has_permission('financial_reports'));

create or replace function public.create_labour_contractor(p_name text, p_role text, p_phone text, p_notes text)
returns public.labour_contractors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.labour_contractors;
begin
  if not (has_permission('expense_manage') or has_permission('design_build_manage')) then
    raise exception 'You do not have permission to add labour contractors.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the contractor or mason name.'; end if;
  insert into public.labour_contractors (name, role, phone, notes)
  values (trim(p_name), coalesce(p_role, 'Contractor'), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.record_labour_entry(
  p_entry_date date, p_contractor_id uuid, p_side text, p_project_id uuid, p_design_project_id uuid,
  p_shifts numeric, p_rate numeric, p_notes text)
returns public.labour_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor public.labour_contractors;
  v_category uuid;
  v_amount numeric;
  v_description text;
  v_expense_id uuid;
  v_row public.labour_entries;
begin
  if not (has_permission('expense_manage') or has_permission('design_build_manage')) then
    raise exception 'You do not have permission to record labour.';
  end if;
  select * into v_contractor from public.labour_contractors where id = p_contractor_id and active;
  if not found then raise exception 'Choose an active contractor or mason.'; end if;
  if p_side not in ('factory', 'design_build') then raise exception 'Choose Design Build or Factory.'; end if;
  if p_side = 'factory' and p_design_project_id is not null then raise exception 'A factory labour entry cannot be charged to a Design Build project.'; end if;
  if p_side = 'design_build' and p_project_id is not null then raise exception 'A Design Build labour entry cannot be charged to a factory project.'; end if;
  if coalesce(p_shifts, 0) <= 0 then raise exception 'Enter the number of shifts.'; end if;
  if coalesce(p_rate, -1) < 0 then raise exception 'Enter the amount per shift.'; end if;

  v_amount := round(p_shifts * p_rate, 2)
  ;
  select id into v_category from public.expense_categories where name = 'Labour';
  if v_category is null then raise exception 'The Labour expense category is missing.'; end if;
  v_description := 'Labour · ' || v_contractor.name || ' · ' || p_shifts::text || ' shift(s) @ ' || p_rate::text;

  if p_side = 'factory' then
    insert into public.expenses (expense_date, category_id, amount, description, project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, v_amount, v_description, p_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  else
    insert into public.design_build_expenses (expense_date, category_id, amount, description, design_project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, v_amount, v_description, p_design_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  end if;

  insert into public.labour_entries (entry_date, contractor_id, side, project_id, design_project_id, shifts, rate_per_shift, expense_id, notes)
  values (coalesce(p_entry_date, current_date), p_contractor_id, p_side, p_project_id, p_design_project_id, p_shifts, p_rate, v_expense_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.void_labour_entry(p_entry_id uuid, p_reason text)
returns public.labour_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.labour_entries;
begin
  if not (has_permission('expense_manage') or has_permission('design_build_manage')) then
    raise exception 'You do not have permission to void labour.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding this labour entry.'; end if;
  select * into v_row from public.labour_entries where id = p_entry_id for update;
  if not found then raise exception 'Labour entry not found.'; end if;
  if v_row.status = 'void' then raise exception 'This labour entry is already void.'; end if;

  if v_row.side = 'factory' then
    update public.expenses set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
    where id = v_row.expense_id;
  else
    update public.design_build_expenses set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
    where id = v_row.expense_id;
  end if;

  update public.labour_entries set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_entry_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_labour_contractor(text, text, text, text) from public, anon;
revoke all on function public.record_labour_entry(date, uuid, text, uuid, uuid, numeric, numeric, text) from public, anon;
revoke all on function public.void_labour_entry(uuid, text) from public, anon;
grant execute on function public.create_labour_contractor(text, text, text, text) to authenticated;
grant execute on function public.record_labour_entry(date, uuid, text, uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function public.void_labour_entry(uuid, text) to authenticated;
