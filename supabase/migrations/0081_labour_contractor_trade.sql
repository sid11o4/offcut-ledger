-- A contractor or mason has a trade (carpenter, painter, mason, ...) and a default rate per shift,
-- which applies to every entry for them and can be changed in their settings.
alter table public.labour_contractors add column if not exists trade text not null default 'General';
alter table public.labour_contractors add column if not exists default_rate numeric(12,2) not null default 0 check (default_rate >= 0);

drop function if exists public.create_labour_contractor(text, text, text, text);

create or replace function public.create_labour_contractor(p_name text, p_trade text, p_rate numeric, p_phone text, p_notes text)
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
  if coalesce(p_rate, -1) < 0 then raise exception 'Enter the rate per shift.'; end if;
  insert into public.labour_contractors (name, trade, default_rate, phone, notes)
  values (
    trim(p_name),
    coalesce(nullif(trim(coalesce(p_trade, '')), ''), 'General'),
    p_rate,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_labour_contractor(
  p_id uuid, p_trade text, p_rate numeric, p_phone text, p_notes text, p_active boolean)
returns public.labour_contractors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.labour_contractors;
begin
  if not (has_permission('expense_manage') or has_permission('design_build_manage')) then
    raise exception 'You do not have permission to change labour contractors.';
  end if;
  if coalesce(p_rate, -1) < 0 then raise exception 'Enter the rate per shift.'; end if;
  update public.labour_contractors set
    trade = coalesce(nullif(trim(coalesce(p_trade, '')), ''), 'General'),
    default_rate = p_rate,
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    active = coalesce(p_active, active)
  where id = p_id
  returning * into v_row;
  if not found then raise exception 'Contractor not found.'; end if;
  return v_row;
end;
$$;

revoke all on function public.create_labour_contractor(text, text, numeric, text, text) from public, anon;
revoke all on function public.update_labour_contractor(uuid, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.create_labour_contractor(text, text, numeric, text, text) to authenticated;
grant execute on function public.update_labour_contractor(uuid, text, numeric, text, text, boolean) to authenticated;
