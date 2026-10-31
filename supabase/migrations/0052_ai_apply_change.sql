-- Structured changes for the search bar. The assistant proposes a change as plain data: an operation
-- (insert, update or delete), a table, the values, and for update or delete the records to match. The
-- database builds the statement from those parts, so the approval screen shows exactly what runs.
--
-- Guardrails: public tables only; no user, role, permission or audit tables; columns must exist; update
-- and delete need a match; a value given as a name for a *_id column is looked up in the table it points
-- to. Runs as the caller, so Row Level Security applies. Every change is logged in ai_action_log.

create or replace function public.ai_apply_change(p_op text, p_table text, p_values jsonb, p_match jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_op text := lower(coalesce(p_op, ''));
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_match jsonb := coalesce(p_match, '{}'::jsonb);
  v_key text;
  v_val jsonb;
  v_col text;
  v_ref_table text;
  v_found uuid;
  v_set text := '';
  v_where text := '';
  v_cols text := '';
  v_vals text := '';
  v_sql text;
  v_rows int;
begin
  if v_op not in ('insert', 'update', 'delete') then
    raise exception 'The change must be an add, a change or a removal.';
  end if;
  if coalesce(p_table, '') = '' or not exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = p_table and table_type = 'BASE TABLE'
  ) then
    raise exception 'There is no table called "%".', p_table;
  end if;
  if p_table ~* '(profile|role|permission|user|audit|ai_action_log|session|secret|key)' then
    raise exception 'Changes to "%" are not allowed from the search bar.', p_table;
  end if;
  if v_op in ('update', 'delete') and (v_match is null or v_match = '{}'::jsonb) then
    raise exception 'A change or removal must say which records it applies to.';
  end if;
  if v_op = 'delete' then
    v_values := '{}'::jsonb;
  end if;

  -- Resolves a name given for a *_id column to the id of the record with that name.
  for v_key, v_val in select * from jsonb_each(v_values) loop
    if v_key like '%\_id' and jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select ccu.table_name into v_ref_table
      from information_schema.key_column_usage kcu
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = kcu.constraint_name
      join information_schema.table_constraints tc on tc.constraint_name = kcu.constraint_name and tc.constraint_type = 'FOREIGN KEY'
      where kcu.table_schema = 'public' and kcu.table_name = p_table and kcu.column_name = v_key
      limit 1;
      if v_ref_table is null then
        raise exception 'The value for "%" must be an existing record.', v_key;
      end if;
      execute format('select id from %I where name = %L', v_ref_table, v_val #>> '{}') into v_found;
      if v_found is null then
        raise exception 'No % called "%" was found.', v_ref_table, v_val #>> '{}';
      end if;
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_found::text));
    end if;
  end loop;

  -- Every column named must exist on the table.
  for v_col in select jsonb_object_keys(v_values) union select jsonb_object_keys(v_match) loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = v_col) then
      raise exception 'The table "%" has no field called "%".', p_table, v_col;
    end if;
  end loop;

  if v_op = 'insert' then
    if v_values = '{}'::jsonb then raise exception 'Give the values for the new record.'; end if;
    select string_agg(format('%I', k), ', '), string_agg(case when jsonb_typeof(v) = 'null' then 'null' else quote_literal(v #>> '{}') end, ', ')
      into v_cols, v_vals
    from jsonb_each(v_values) as t(k, v);
    v_sql := format('insert into %I (%s) values (%s)', p_table, v_cols, v_vals);
  else
    select string_agg(format('%I = %s', k, case when jsonb_typeof(v) = 'null' then 'null' else quote_literal(v #>> '{}') end), ', ')
      into v_set from jsonb_each(v_values) as t(k, v);
    select string_agg(format('%I = %s', k, quote_literal(v #>> '{}')), ' and ')
      into v_where from jsonb_each(v_match) as t(k, v);
    if v_op = 'update' then
      if v_set is null then raise exception 'Say what to change.'; end if;
      v_sql := format('update %I set %s where %s', p_table, v_set, v_where);
    else
      v_sql := format('delete from %I where %s', p_table, v_where);
    end if;
  end if;

  execute v_sql;
  get diagnostics v_rows = row_count;
  insert into public.ai_action_log (user_id, sql_text, rows_affected) values (auth.uid(), v_sql, v_rows);
  return v_rows;
end;
$$;

revoke execute on function public.ai_apply_change(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.ai_apply_change(text, text, jsonb, jsonb) to authenticated;
