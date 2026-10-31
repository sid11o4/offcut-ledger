-- SQL access for the search bar's assistant.
--
-- Reads: ai_run_read runs one SELECT as the signed-in caller (SECURITY INVOKER), so Row Level Security
-- decides what it sees. No other limits on reading.
--
-- Writes: ai_run_write runs one INSERT, UPDATE or DELETE, and only after the user approves it in the UI.
-- Guardrails: a single statement only; no schema or permission changes; no auth, storage, vault or cron
-- schemas; UPDATE and DELETE need a WHERE clause. It runs as the caller, so Row Level Security applies.
-- Every write is logged in ai_action_log.

create table if not exists public.ai_action_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id),
  sql_text text not null,
  rows_affected int,
  error text
);

alter table public.ai_action_log enable row level security;

create policy ai_action_log_insert on public.ai_action_log for insert
  with check (user_id = auth.uid());

create policy ai_action_log_select on public.ai_action_log for select
  using (public.has_permission('financial_reports'));

create or replace function public.ai_run_read(p_sql text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sql text := btrim(regexp_replace(coalesce(p_sql, ''), ';\s*$', ''));
  v_result jsonb;
begin
  if v_sql = '' then raise exception 'The query is empty.'; end if;
  if v_sql like '%;%' then raise exception 'Send one statement at a time.'; end if;
  if v_sql !~* '^\s*(select|with|values|table)\y' then raise exception 'Only SELECT queries can be read here.'; end if;
  if v_sql ~* '\y(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|comment|vacuum|reindex|lock)\y' then
    raise exception 'That query changes data, which is not allowed in a read.';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 1000) t', v_sql)
    into v_result;
  return v_result;
end;
$$;

create or replace function public.ai_run_write(p_sql text)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sql text := btrim(regexp_replace(coalesce(p_sql, ''), ';\s*$', ''));
  v_rows int;
begin
  if v_sql = '' then raise exception 'The change is empty.'; end if;
  if v_sql like '%;%' then raise exception 'Send one change at a time.'; end if;
  if v_sql !~* '^\s*(insert|update|delete)\y' then raise exception 'Only INSERT, UPDATE or DELETE can be run here.'; end if;
  if v_sql ~* '\y(drop|alter|create|grant|revoke|truncate|copy|call|do|comment|vacuum|reindex|cluster|lock|reset|execute|merge|auth|storage|vault|cron|extensions|pg_catalog|information_schema)\y'
     or v_sql ~* '\yset\s+(role|session|local|search_path|transaction)\y' then
    raise exception 'That change is not allowed here.';
  end if;
  if v_sql ~* '^\s*(update|delete)\y' and v_sql !~* '\ywhere\y' then
    raise exception 'An UPDATE or DELETE must have a WHERE clause.';
  end if;

  execute v_sql;
  get diagnostics v_rows = row_count;

  insert into public.ai_action_log (user_id, sql_text, rows_affected) values (auth.uid(), v_sql, v_rows);
  return v_rows;
end;
$$;

revoke execute on function public.ai_run_read(text) from public, anon;
revoke execute on function public.ai_run_write(text) from public, anon;
grant execute on function public.ai_run_read(text) to authenticated;
grant execute on function public.ai_run_write(text) to authenticated;
