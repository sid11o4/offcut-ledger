-- Audit trail (spec section 38): generic trigger attached to every table where changes
-- must be traceable. Never deletes -- append-only.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  user_id uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb
);
create index idx_audit_table_record on public.audit_logs(table_name, record_id);
create index idx_audit_changed_at on public.audit_logs(changed_at);
create index idx_audit_user on public.audit_logs(user_id);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Some audited tables (role_permissions) have a composite key with no "id" column, so the
  -- record id is pulled dynamically from the jsonb form rather than referenced as new.id/old.id
  -- (which would fail to compile against tables lacking that field).
  insert into public.audit_logs (table_name, record_id, action, user_id, old_values, new_values)
  values (
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then (to_jsonb(old) ->> 'id')::uuid else (to_jsonb(new) ->> 'id')::uuid end,
    TG_OP,
    auth.uid(),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'rates', 'job_work_entries', 'job_work_entry_components', 'projects', 'clients',
    'bills', 'estimates', 'expenses', 'recurring_expenses',
    'machines', 'processes', 'units', 'job_work_services', 'job_work_components',
    'rate_categories', 'expense_categories', 'role_permissions', 'profiles'
  ]
  loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row_change();',
      t
    );
  end loop;
end;
$$;
