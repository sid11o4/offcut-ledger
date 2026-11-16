-- Labour can also be paid bonuses, advances and other payments that are not shifts. Each labour
-- entry has a kind: a shift (shifts x rate) or a payment (an amount with remarks). Payments are
-- written to the expense ledger under Labour, like shifts.

alter table public.labour_entries alter column amount drop expression;
alter table public.labour_entries alter column shifts drop not null;
alter table public.labour_entries alter column rate_per_shift drop not null;
alter table public.labour_entries add column if not exists kind text not null default 'shift'
  check (kind in ('shift', 'bonus', 'advance', 'other'));
alter table public.labour_entries drop constraint if exists labour_entries_shifts_check;
alter table public.labour_entries add constraint labour_entries_kind_shape check (
  (kind = 'shift' and shifts is not null and shifts > 0 and rate_per_shift is not null and amount >= 0)
  or (kind <> 'shift' and shifts is null and rate_per_shift is null and amount > 0));

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

  v_amount := round(p_shifts * p_rate, 2);
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

  insert into public.labour_entries (entry_date, contractor_id, side, project_id, design_project_id, kind, shifts, rate_per_shift, amount, expense_id, notes)
  values (coalesce(p_entry_date, current_date), p_contractor_id, p_side, p_project_id, p_design_project_id, 'shift', p_shifts, p_rate, v_amount, v_expense_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.record_labour_payment(
  p_entry_date date, p_contractor_id uuid, p_side text, p_project_id uuid, p_design_project_id uuid,
  p_kind text, p_amount numeric, p_notes text)
returns public.labour_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor public.labour_contractors;
  v_category uuid;
  v_description text;
  v_expense_id uuid;
  v_label text;
  v_row public.labour_entries;
begin
  if not (has_permission('expense_manage') or has_permission('design_build_manage')) then
    raise exception 'You do not have permission to record labour.';
  end if;
  select * into v_contractor from public.labour_contractors where id = p_contractor_id and active;
  if not found then raise exception 'Choose an active contractor or mason.'; end if;
  if p_kind not in ('bonus', 'advance', 'other') then raise exception 'Choose bonus, advance or other payment.'; end if;
  if p_side not in ('factory', 'design_build') then raise exception 'Choose Design Build or Factory.'; end if;
  if p_side = 'factory' and p_design_project_id is not null then raise exception 'A factory labour payment cannot be charged to a Design Build project.'; end if;
  if p_side = 'design_build' and p_project_id is not null then raise exception 'A Design Build labour payment cannot be charged to a factory project.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.'; end if;

  select id into v_category from public.expense_categories where name = 'Labour';
  if v_category is null then raise exception 'The Labour expense category is missing.'; end if;
  v_label := case p_kind when 'bonus' then 'Bonus' when 'advance' then 'Advance' else 'Other payment' end;
  v_description := 'Labour · ' || v_contractor.name || ' · ' || v_label
    || coalesce(' · ' || nullif(trim(coalesce(p_notes, '')), ''), '');

  if p_side = 'factory' then
    insert into public.expenses (expense_date, category_id, amount, description, project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, p_amount, v_description, p_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  else
    insert into public.design_build_expenses (expense_date, category_id, amount, description, design_project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, p_amount, v_description, p_design_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  end if;

  insert into public.labour_entries (entry_date, contractor_id, side, project_id, design_project_id, kind, shifts, rate_per_shift, amount, expense_id, notes)
  values (coalesce(p_entry_date, current_date), p_contractor_id, p_side, p_project_id, p_design_project_id, p_kind, null, null, round(p_amount, 2), v_expense_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

-- Rows are shifts (the default) or payments (kind bonus, advance or other), saved in one transaction.
create or replace function public.record_labour_entries(p_entry_date date, p_notes text, p_rows jsonb)
returns setof public.labour_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v public.labour_entries;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Add at least one labour row.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'kind', 'shift') = 'shift' then
      v := public.record_labour_entry(
        p_entry_date,
        (r->>'contractor_id')::uuid,
        r->>'side',
        nullif(r->>'project_id', '')::uuid,
        nullif(r->>'design_project_id', '')::uuid,
        (r->>'shifts')::numeric,
        (r->>'rate')::numeric,
        coalesce(nullif(r->>'notes', ''), p_notes));
    else
      v := public.record_labour_payment(
        p_entry_date,
        (r->>'contractor_id')::uuid,
        r->>'side',
        nullif(r->>'project_id', '')::uuid,
        nullif(r->>'design_project_id', '')::uuid,
        r->>'kind',
        (r->>'amount')::numeric,
        coalesce(nullif(r->>'notes', ''), p_notes));
    end if;
    return next v;
  end loop;
  return;
end;
$$;

revoke all on function public.record_labour_payment(date, uuid, text, uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.record_labour_payment(date, uuid, text, uuid, uuid, text, numeric, text) to authenticated;
