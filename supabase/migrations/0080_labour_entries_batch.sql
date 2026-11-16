-- Several labour rows for one day, each to its own project, saved in one transaction: if any row
-- fails (for example a missing contractor), none of them are saved.
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
    v := public.record_labour_entry(
      p_entry_date,
      (r->>'contractor_id')::uuid,
      r->>'side',
      nullif(r->>'project_id', '')::uuid,
      nullif(r->>'design_project_id', '')::uuid,
      (r->>'shifts')::numeric,
      (r->>'rate')::numeric,
      p_notes);
    return next v;
  end loop;
  return;
end;
$$;

revoke all on function public.record_labour_entries(date, text, jsonb) from public, anon;
grant execute on function public.record_labour_entries(date, text, jsonb) to authenticated;
