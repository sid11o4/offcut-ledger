-- Scubo Lead Desk: everything lives in its own `leaddesk` schema so it shares the
-- formgrid-factory Supabase project (and its auth.users) without touching any
-- Formgrid table, function or policy.
--
-- Access model: signing in is not enough. A user must have an active row in
-- leaddesk.members to see or change anything here. Formgrid users are NOT lead desk
-- members unless an admin adds them, and vice versa.

create schema if not exists leaddesk;

grant usage on schema leaddesk to anon, authenticated, service_role;

-- ---------------------------------------------------------------- members
create table leaddesk.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function leaddesk.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from leaddesk.members where user_id = auth.uid() and active);
$$;

create or replace function leaddesk.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from leaddesk.members where user_id = auth.uid() and active and role = 'admin');
$$;

-- Never leave the lead desk without an active admin.
create or replace function leaddesk.members_last_admin_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and not (new.role = 'admin' and new.active) then
    perform pg_advisory_xact_lock(hashtext('leaddesk.members_last_admin_guard'));
    if not exists (select 1 from leaddesk.members
                   where role = 'admin' and active and user_id <> old.user_id) then
      raise exception 'The lead desk needs at least one active admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_members_last_admin_guard before update on leaddesk.members
  for each row execute function leaddesk.members_last_admin_guard();

-- ---------------------------------------------------------------- projects
create table leaddesk.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index projects_name_uq on leaddesk.projects (lower(name));

-- ---------------------------------------------------------------- leads
create table leaddesk.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '' check (phone = '' or phone ~ '^[0-9]{10}$'),
  email text not null default '',
  area text not null default '',
  source text not null default '',
  project_id uuid references leaddesk.projects(id) on delete set null,
  requirement text not null default '',
  budget_lakhs numeric(12, 2) check (budget_lakhs is null or budget_lakhs >= 0),
  stage text not null default 'New' check (stage in (
    'New', 'Contacted', 'Interested', 'Site Visit Scheduled', 'Site Visit Done',
    'Negotiation', 'Booked', 'Not Qualified')),
  priority text not null default '' check (priority in ('', 'Hot', 'Warm', 'Cold')),
  assigned_to uuid references leaddesk.members(user_id) on delete set null,
  next_follow_up date,
  lost_reason text not null default '',
  booked_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  check (name <> '' or phone <> '')
);
-- One lead per phone number: stops two agents creating the same lead at once and
-- makes CSV re-imports idempotent.
create unique index leads_phone_uq on leaddesk.leads (phone) where phone <> '';
create index leads_stage_idx on leaddesk.leads (stage);
create index leads_follow_idx on leaddesk.leads (next_follow_up);
create index leads_assigned_idx on leaddesk.leads (assigned_to);
create index leads_project_idx on leaddesk.leads (project_id);

-- ---------------------------------------------------------------- activity
-- Separate rows (not an array on the lead) so concurrent notes from two people
-- never overwrite each other.
create table leaddesk.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leaddesk.leads(id) on delete cascade,
  type text not null check (type in ('created', 'note', 'log', 'stage', 'follow')),
  text text not null,
  at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index activities_lead_idx on leaddesk.activities (lead_id, at);

-- ---------------------------------------------------------------- triggers
-- Stage / follow-up / assignee changes are logged server-side in the same
-- transaction as the update, so the timeline can't drift from the lead.
create or replace function leaddesk.leads_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.stage = 'Booked' and (tg_op = 'INSERT' or old.stage is distinct from 'Booked') then
    new.booked_at := now();
  end if;
  if new.stage <> 'Not Qualified' then
    new.lost_reason := '';
  end if;
  return new;
end;
$$;

create trigger trg_leads_before_write before insert or update on leaddesk.leads
  for each row execute function leaddesk.leads_before_write();

create or replace function leaddesk.leads_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if new.stage is distinct from old.stage then
    insert into leaddesk.activities (lead_id, type, text)
    values (new.id, 'stage', 'Stage: ' || old.stage || ' → ' || new.stage
      || case when new.stage = 'Not Qualified' and new.lost_reason <> '' then ' (' || new.lost_reason || ')' else '' end);
  end if;
  if new.next_follow_up is distinct from old.next_follow_up then
    insert into leaddesk.activities (lead_id, type, text)
    values (new.id, 'follow', case when new.next_follow_up is null then 'Follow-up cleared'
      else 'Follow-up set for ' || to_char(new.next_follow_up, 'FMDD Mon') end);
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    select display_name into v_name from leaddesk.members where user_id = new.assigned_to;
    insert into leaddesk.activities (lead_id, type, text)
    values (new.id, 'follow', 'Assigned to ' || coalesce(v_name, 'someone'));
  end if;
  return null;
end;
$$;

create trigger trg_leads_after_update after update on leaddesk.leads
  for each row execute function leaddesk.leads_after_update();

-- Touch the lead when activity is added so "recently updated" sorting stays right.
create or replace function leaddesk.activities_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update leaddesk.leads
     set updated_at = now(),
         last_contact_at = case when new.type = 'log' then now() else last_contact_at end
   where id = new.lead_id;
  return null;
end;
$$;

create trigger trg_activities_after_insert after insert on leaddesk.activities
  for each row execute function leaddesk.activities_after_insert();

-- ---------------------------------------------------------------- RLS
alter table leaddesk.members enable row level security;
alter table leaddesk.projects enable row level security;
alter table leaddesk.leads enable row level security;
alter table leaddesk.activities enable row level security;

create policy members_read on leaddesk.members for select to authenticated
  using (leaddesk.is_member() or user_id = auth.uid());
create policy members_admin_update on leaddesk.members for update to authenticated
  using (leaddesk.is_admin()) with check (leaddesk.is_admin());

create policy projects_read on leaddesk.projects for select to authenticated using (leaddesk.is_member());
create policy projects_admin_insert on leaddesk.projects for insert to authenticated with check (leaddesk.is_admin());
create policy projects_admin_update on leaddesk.projects for update to authenticated
  using (leaddesk.is_admin()) with check (leaddesk.is_admin());
create policy projects_admin_delete on leaddesk.projects for delete to authenticated using (leaddesk.is_admin());

create policy leads_read on leaddesk.leads for select to authenticated using (leaddesk.is_member());
create policy leads_insert on leaddesk.leads for insert to authenticated with check (leaddesk.is_member());
create policy leads_update on leaddesk.leads for update to authenticated
  using (leaddesk.is_member()) with check (leaddesk.is_member());
create policy leads_admin_delete on leaddesk.leads for delete to authenticated using (leaddesk.is_admin());

create policy activities_read on leaddesk.activities for select to authenticated using (leaddesk.is_member());
create policy activities_insert on leaddesk.activities for insert to authenticated
  with check (leaddesk.is_member() and type in ('created', 'note', 'log'));
create policy activities_admin_delete on leaddesk.activities for delete to authenticated using (leaddesk.is_admin());

grant select, update on leaddesk.members to authenticated;
grant select, insert, update, delete on leaddesk.projects, leaddesk.leads to authenticated;
grant select, insert, delete on leaddesk.activities to authenticated;
grant all on all tables in schema leaddesk to service_role;

-- ---------------------------------------------------------------- RPCs
-- Bootstrap: while the lead desk has no members, a Formgrid admin (user_manage
-- permission) can make themselves the first lead desk admin.
create or replace function leaddesk.claim_first_admin()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext('leaddesk.claim_first_admin'));
  if exists (select 1 from leaddesk.members) then return false; end if;
  if not public.has_permission('user_manage') then
    raise exception 'Only a Formgrid admin can set up the lead desk';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into leaddesk.members (user_id, display_name, email, role)
  values (auth.uid(), coalesce(split_part(v_email, '@', 1), 'Admin'), v_email, 'admin');
  return true;
end;
$$;

create or replace function leaddesk.needs_setup()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from leaddesk.members);
$$;

-- Bulk import (CSV). Skips blank and already-known phone numbers in one statement.
create or replace function leaddesk.import_leads(p_rows jsonb)
returns table (added integer, skipped integer)
language plpgsql set search_path = '' as $$
declare
  v_total integer := jsonb_array_length(p_rows);
  v_added integer;
begin
  if not leaddesk.is_member() then raise exception 'Not a lead desk member'; end if;
  if v_total > 5000 then raise exception 'Import at most 5000 rows at a time'; end if;

  with src as (
    select distinct on (r ->> 'phone')
      coalesce(nullif(trim(r ->> 'name'), ''), 'Unnamed') as name,
      r ->> 'phone' as phone,
      coalesce(trim(r ->> 'email'), '') as email,
      coalesce(trim(r ->> 'area'), '') as area,
      coalesce(r ->> 'created_at', now()::text)::timestamptz as created_at,
      coalesce(nullif(trim(r ->> 'note'), ''), 'Imported from Meta CSV') as note
    from jsonb_array_elements(p_rows) r
    where coalesce(r ->> 'phone', '') ~ '^[0-9]{10}$'
  ), ins as (
    insert into leaddesk.leads (name, phone, email, area, source, priority, stage, next_follow_up, created_at)
    select name, phone, email, area, 'Meta – Lead form', 'Warm', 'New', (now() at time zone 'Asia/Kolkata')::date, created_at from src
    on conflict (phone) where phone <> '' do nothing
    returning id, phone
  ), acts as (
    insert into leaddesk.activities (lead_id, type, text)
    select ins.id, 'created', src.note from ins join src using (phone)
    returning 1
  )
  select count(*) into v_added from acts;

  return query select v_added, v_total - v_added;
end;
$$;

revoke all on function leaddesk.claim_first_admin(), leaddesk.needs_setup(), leaddesk.import_leads(jsonb) from public, anon;
grant execute on function leaddesk.claim_first_admin(), leaddesk.needs_setup(), leaddesk.import_leads(jsonb),
  leaddesk.is_member(), leaddesk.is_admin() to authenticated;

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table leaddesk.leads, leaddesk.activities, leaddesk.projects, leaddesk.members;
