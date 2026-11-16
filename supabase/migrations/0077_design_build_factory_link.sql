-- Design Build and Factory share one set of projects:
--  * every Design Build project has a Factory project, created automatically (INTERNAL rate category);
--  * only Internal Orders (billed job work on an INTERNAL project) create or show a Design Build project;
--  * the INTERNAL rate category is shown as "Design Build Order".

update public.rate_categories set name = 'Design Build Order' where code = 'INTERNAL';

insert into public.clients (code, name)
values ('DB-INTERNAL', 'Design Build (internal)')
on conflict (code) do nothing;

-- Creates the Factory project for a Design Build project, once.
create or replace function public.ensure_factory_project_for_design(p_design_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_design public.design_projects%rowtype;
  v_client uuid;
  v_rate uuid;
  v_fid uuid;
begin
  select * into v_design from public.design_projects where id = p_design_project_id;
  if not found then return null; end if;
  if v_design.factory_project_id is not null then return v_design.factory_project_id; end if;

  select id into v_client from public.clients where code = 'DB-INTERNAL';
  select id into v_rate from public.rate_categories where code = 'INTERNAL';

  insert into public.projects (code, name, client_id, rate_category_id, start_date, status)
  values (
    'FD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    v_design.name,
    coalesce(v_design.client_id, v_client),
    v_rate,
    coalesce(v_design.start_date, current_date),
    'active')
  returning id into v_fid;

  update public.design_projects set factory_project_id = v_fid where id = p_design_project_id;
  return v_fid;
end;
$$;

revoke all on function public.ensure_factory_project_for_design(uuid) from public, anon, authenticated;

create or replace function public.design_projects_create_factory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.factory_project_id is null then
    perform public.ensure_factory_project_for_design(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.design_projects_create_factory() from public, anon, authenticated;

drop trigger if exists design_projects_create_factory on public.design_projects;
create trigger design_projects_create_factory
  after insert on public.design_projects
  for each row execute function public.design_projects_create_factory();

-- Backfill: any Design Build project without a Factory project.
select public.ensure_factory_project_for_design(d.id) from public.design_projects d where d.factory_project_id is null;

-- A Design Build project appears only for an Internal Order: billed job work on an INTERNAL project.
create or replace function public.job_work_entries_link_design_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.billed and new.status = 'active' and exists (
    select 1 from public.projects p
    join public.rate_categories rc on rc.id = p.rate_category_id
    where p.id = new.project_id and rc.code = 'INTERNAL'
  ) then
    perform public.ensure_design_project_for_factory(new.project_id);
  end if;
  return new;
end;
$$;

-- Remove Design Build projects whose Factory project is not an Internal Order, when nothing depends on them.
do $$
declare
  r record;
begin
  for r in
    select d.id from public.design_projects d
    join public.projects p on p.id = d.factory_project_id
    join public.rate_categories rc on rc.id = p.rate_category_id
    where rc.code <> 'INTERNAL'
  loop
    if not exists (select 1 from public.inventory_transactions t join public.inventory_locations l on l.id = t.location_id where l.design_project_id = r.id)
       and not exists (select 1 from public.supplier_bills b where b.design_project_id = r.id)
       and not exists (select 1 from public.design_build_expenses x where x.design_project_id = r.id)
       and not exists (select 1 from public.project_quotations q where q.design_project_id = r.id)
       and not exists (select 1 from public.project_collections c where c.design_project_id = r.id)
    then
      delete from public.inventory_stock s using public.inventory_locations l where s.location_id = l.id and l.design_project_id = r.id and s.quantity = 0;
      delete from public.inventory_locations where design_project_id = r.id;
      delete from public.design_projects where id = r.id;
    end if;
  end loop;
end $$;
