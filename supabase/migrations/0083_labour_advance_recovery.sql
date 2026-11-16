-- Advances are repaid by deducting them from the contractor's shift pay. A shift entry records the
-- advance it recovers; its expense is the gross pay less that recovery. Bonuses are not repaid, so
-- they are never recovered. A recovery cannot exceed the advance still outstanding for the contractor.

alter table public.labour_entries add column if not exists recovery numeric(14,2) not null default 0 check (recovery >= 0);

drop function if exists public.record_labour_entry(date, uuid, text, uuid, uuid, numeric, numeric, text);

create or replace function public.record_labour_entry(
  p_entry_date date, p_contractor_id uuid, p_side text, p_project_id uuid, p_design_project_id uuid,
  p_shifts numeric, p_rate numeric, p_notes text, p_recovery numeric default 0)
returns public.labour_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor public.labour_contractors;
  v_category uuid;
  v_gross numeric;
  v_amount numeric;
  v_outstanding numeric;
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

  v_gross := round(p_shifts * p_rate, 2);
  if coalesce(p_recovery, 0) < 0 then raise exception 'The advance recovered cannot be negative.'; end if;
  if coalesce(p_recovery, 0) > v_gross then raise exception 'The advance recovered is more than the shift pay (₹%).', v_gross; end if;
  if coalesce(p_recovery, 0) > 0 then
    select coalesce(sum(case when kind = 'advance' then amount else 0 end), 0) - coalesce(sum(recovery), 0)
      into v_outstanding
      from public.labour_entries
      where contractor_id = p_contractor_id and status = 'active';
    if p_recovery > v_outstanding then
      raise exception 'The advance recovered (₹%) is more than the advance outstanding for % (₹%).', p_recovery, v_contractor.name, v_outstanding;
    end if;
  end if;

  v_amount := v_gross - coalesce(p_recovery, 0);
  select id into v_category from public.expense_categories where name = 'Labour';
  if v_category is null then raise exception 'The Labour expense category is missing.'; end if;
  v_description := 'Labour · ' || v_contractor.name || ' · ' || p_shifts::text || ' shift(s) @ ' || p_rate::text
    || case when coalesce(p_recovery, 0) > 0 then ' less advance recovered ' || p_recovery::text else '' end;

  if p_side = 'factory' then
    insert into public.expenses (expense_date, category_id, amount, description, project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, v_amount, v_description, p_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  else
    insert into public.design_build_expenses (expense_date, category_id, amount, description, design_project_id, source, notes, created_by)
    values (coalesce(p_entry_date, current_date), v_category, v_amount, v_description, p_design_project_id, 'manual', p_notes, auth.uid())
    returning id into v_expense_id;
  end if;

  insert into public.labour_entries (entry_date, contractor_id, side, project_id, design_project_id, kind, shifts, rate_per_shift, amount, recovery, expense_id, notes)
  values (coalesce(p_entry_date, current_date), p_contractor_id, p_side, p_project_id, p_design_project_id, 'shift', p_shifts, p_rate, v_amount, coalesce(p_recovery, 0), v_expense_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

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
        coalesce(nullif(r->>'notes', ''), p_notes),
        coalesce(nullif(r->>'recovery', '')::numeric, 0));
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

revoke all on function public.record_labour_entry(date, uuid, text, uuid, uuid, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.record_labour_entry(date, uuid, text, uuid, uuid, numeric, numeric, text, numeric) to authenticated;
