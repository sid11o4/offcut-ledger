-- Every Factory project that has billed job work gets its own linked Design Build project, so it has
-- its own dashboard, inventory location and project report. Created once, then kept in step by the
-- trigger on billing.
create or replace function public.ensure_design_project_for_factory(p_factory_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  select id into v_id from public.design_projects where factory_project_id = p_factory_project_id limit 1;
  if v_id is not null then return v_id; end if;

  select name into v_name from public.projects where id = p_factory_project_id;
  if v_name is null then return null; end if;

  insert into public.design_projects (code, name, factory_project_id, created_by)
  values ('DP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), v_name, p_factory_project_id, null)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ensure_design_project_for_factory(uuid) from public, anon, authenticated;

create or replace function public.job_work_entries_link_design_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.billed and new.status = 'active' then
    perform public.ensure_design_project_for_factory(new.project_id);
  end if;
  return new;
end;
$$;

revoke all on function public.job_work_entries_link_design_project() from public, anon, authenticated;

drop trigger if exists job_work_entries_link_design_project on public.job_work_entries;
create trigger job_work_entries_link_design_project
  after insert or update of billed, status on public.job_work_entries
  for each row execute function public.job_work_entries_link_design_project();

-- Backfill: every Factory project with billed job work today.
select public.ensure_design_project_for_factory(p.id)
from public.projects p
where exists (select 1 from public.job_work_entries e where e.project_id = p.id and e.billed and e.status = 'active');
