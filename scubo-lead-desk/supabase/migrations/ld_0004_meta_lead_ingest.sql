-- Automatic Meta lead intake (Instant Forms via Pabbly Connect today; a direct Meta webhook or
-- WhatsApp later). Every Meta lead keeps its Meta lead ID plus where it came from, which the
-- Conversions API send-back will need.

-- ---------------------------------------------------------------- lead columns
alter table leaddesk.leads
  add column meta_lead_id text,          -- Meta leadgen ID (Instant Forms)
  add column meta_form_id text,
  add column meta_form_name text not null default '',
  add column meta_campaign_id text,
  add column meta_campaign_name text not null default '',
  add column meta_adset_id text,
  add column meta_adset_name text not null default '',
  add column meta_ad_id text,
  add column meta_ad_name text not null default '',
  add column meta_page_id text,
  add column meta_platform text not null default '',   -- fb / ig
  add column meta_answers jsonb not null default '{}', -- custom form questions
  add column ctwa_clid text;                            -- WhatsApp ad click ID (future)

create unique index leads_meta_lead_id_uq on leaddesk.leads (meta_lead_id) where meta_lead_id is not null;

-- ---------------------------------------------------------------- intake config + log
-- One row: the secret token that authenticates the import address. Only admins can read it
-- (it's shown in Settings so they can paste it into Pabbly) or rotate it.
create table leaddesk.intake_config (
  id boolean primary key default true check (id),
  token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  rotated_at timestamptz not null default now()
);
insert into leaddesk.intake_config default values;

alter table leaddesk.intake_config enable row level security;
create policy intake_config_admin_read on leaddesk.intake_config for select to authenticated using (leaddesk.is_admin());
grant select on leaddesk.intake_config to authenticated;

create or replace function leaddesk.rotate_intake_token()
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not leaddesk.is_admin() then raise exception 'Only a lead desk admin can do that'; end if;
  update leaddesk.intake_config
     set token = encode(extensions.gen_random_bytes(24), 'hex'), rotated_at = now()
   where id
   returning token into v;
  return v;
end;
$$;

-- What arrived and what happened to it, so a missing lead can be traced. Kept 30 days.
create table leaddesk.intake_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  status text not null check (status in ('created', 'duplicate', 'repeat', 'rejected', 'error')),
  message text not null default '',
  lead_id uuid references leaddesk.leads(id) on delete set null,
  payload jsonb
);
create index intake_log_at_idx on leaddesk.intake_log (at desc);

alter table leaddesk.intake_log enable row level security;
create policy intake_log_admin_read on leaddesk.intake_log for select to authenticated using (leaddesk.is_admin());
grant select on leaddesk.intake_log to authenticated;
grant all on leaddesk.intake_config, leaddesk.intake_log to service_role;

-- ---------------------------------------------------------------- ingest
-- Called only by the leaddesk-intake Edge Function (service role) with a normalised payload:
--   { source, meta_lead_id, created_time, full_name, phone, email, city,
--     form_id, form_name, campaign_id, campaign_name, adset_id, adset_name,
--     ad_id, ad_name, page_id, platform, answers: {question: answer}, raw_phone }
-- Returns { status, lead_id, message }.
create or replace function leaddesk.ingest_meta_lead(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_meta_id text := nullif(trim(p ->> 'meta_lead_id'), '');
  v_phone text := coalesce(p ->> 'phone', '');
  v_name text := coalesce(nullif(trim(p ->> 'full_name'), ''), '');
  v_id uuid;
  v_stage text;
  v_origin text;
  v_project uuid;
  v_answers jsonb := coalesce(p -> 'answers', '{}'::jsonb);
  v_answer_text text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_phone !~ '^[0-9]{10}$' then v_phone := ''; end if;
  if v_phone = '' and v_name = '' then
    return jsonb_build_object('status', 'rejected', 'message', 'No usable name or 10-digit phone number');
  end if;

  v_origin := concat_ws(' · ',
    nullif(p ->> 'campaign_name', ''), nullif(p ->> 'ad_name', ''), nullif(p ->> 'form_name', ''));

  -- Same Meta lead delivered twice (Pabbly retry, re-run): nothing to do.
  if v_meta_id is not null then
    select id into v_id from leaddesk.leads where meta_lead_id = v_meta_id;
    if found then
      return jsonb_build_object('status', 'duplicate', 'lead_id', v_id, 'message', 'Meta lead already imported');
    end if;
  end if;

  select string_agg(key || ': ' || value, E'\n' order by key) into v_answer_text
    from jsonb_each_text(v_answers) where value <> '';

  -- Known phone number: log the repeat enquiry on the existing lead instead of a duplicate.
  if v_phone <> '' then
    select id, stage into v_id, v_stage from leaddesk.leads where phone = v_phone;
    if found then
      insert into leaddesk.activities (lead_id, type, text, created_by)
      values (v_id, 'note', 'Enquired again via Meta lead form'
        || coalesce(' · ' || nullif(v_origin, ''), '')
        || coalesce(E'\nMeta lead ID: ' || v_meta_id, '')
        || coalesce(E'\n' || v_answer_text, ''), null);
      if v_stage not in ('Booked', 'Not Qualified') then
        update leaddesk.leads set next_follow_up = least(coalesce(next_follow_up, v_today), v_today) where id = v_id;
      end if;
      return jsonb_build_object('status', 'repeat', 'lead_id', v_id, 'message', 'Phone already in the desk; added a note');
    end if;
  end if;

  -- A custom question naming one of our projects tags the lead with it.
  select pr.id into v_project
    from leaddesk.projects pr, jsonb_each_text(v_answers) a
   where pr.active and lower(trim(a.value)) = lower(pr.name)
   limit 1;

  insert into leaddesk.leads (
    name, phone, email, area, source, stage, priority, next_follow_up, project_id, created_at, created_by,
    meta_lead_id, meta_form_id, meta_form_name, meta_campaign_id, meta_campaign_name,
    meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name, meta_page_id, meta_platform, meta_answers)
  values (
    coalesce(nullif(v_name, ''), 'Unnamed'), v_phone, coalesce(trim(p ->> 'email'), ''), coalesce(trim(p ->> 'city'), ''),
    'Meta – Lead form', 'New', 'Warm', v_today, v_project,
    coalesce((p ->> 'created_time')::timestamptz, now()), null,
    v_meta_id, nullif(p ->> 'form_id', ''), coalesce(p ->> 'form_name', ''),
    nullif(p ->> 'campaign_id', ''), coalesce(p ->> 'campaign_name', ''),
    nullif(p ->> 'adset_id', ''), coalesce(p ->> 'adset_name', ''),
    nullif(p ->> 'ad_id', ''), coalesce(p ->> 'ad_name', ''),
    nullif(p ->> 'page_id', ''), coalesce(p ->> 'platform', ''), v_answers)
  returning id into v_id;

  insert into leaddesk.activities (lead_id, type, text, created_by)
  values (v_id, 'created', 'Meta lead form' || coalesce(' · ' || nullif(v_origin, ''), ''), null);
  if v_answer_text is not null then
    insert into leaddesk.activities (lead_id, type, text, created_by)
    values (v_id, 'note', 'Form answers:' || E'\n' || v_answer_text, null);
  end if;
  if (p ->> 'raw_phone') is not null and v_phone = '' then
    insert into leaddesk.activities (lead_id, type, text, created_by)
    values (v_id, 'note', 'Phone on the form wasn''t a 10-digit Indian mobile: ' || (p ->> 'raw_phone'), null);
  end if;

  return jsonb_build_object('status', 'created', 'lead_id', v_id, 'message', 'Lead created');
exception when unique_violation then
  -- Two deliveries of the same lead racing each other: the other one won.
  select id into v_id from leaddesk.leads where meta_lead_id = v_meta_id or (v_phone <> '' and phone = v_phone) limit 1;
  return jsonb_build_object('status', 'duplicate', 'lead_id', v_id, 'message', 'Imported by a parallel delivery');
end;
$$;

revoke execute on function leaddesk.ingest_meta_lead(jsonb), leaddesk.rotate_intake_token() from public, anon, authenticated;
grant execute on function leaddesk.ingest_meta_lead(jsonb) to service_role;
grant execute on function leaddesk.rotate_intake_token() to authenticated;

-- ---------------------------------------------------------------- CSV import keeps Meta IDs too
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
      coalesce(nullif(trim(r ->> 'note'), ''), 'Imported from Meta CSV') as note,
      nullif(trim(r ->> 'meta_lead_id'), '') as meta_lead_id,
      coalesce(trim(r ->> 'campaign_name'), '') as campaign_name,
      coalesce(trim(r ->> 'form_name'), '') as form_name,
      coalesce(trim(r ->> 'ad_name'), '') as ad_name,
      coalesce(trim(r ->> 'platform'), '') as platform
    from jsonb_array_elements(p_rows) r
    where coalesce(r ->> 'phone', '') ~ '^[0-9]{10}$'
  ), fresh as (
    select * from src s
    where s.meta_lead_id is null
       or not exists (select 1 from leaddesk.leads l where l.meta_lead_id = s.meta_lead_id)
  ), ins as (
    insert into leaddesk.leads (name, phone, email, area, source, priority, stage, next_follow_up, created_at,
                                meta_lead_id, meta_campaign_name, meta_form_name, meta_ad_name, meta_platform)
    select name, phone, email, area, 'Meta – Lead form', 'Warm', 'New', (now() at time zone 'Asia/Kolkata')::date, created_at,
           meta_lead_id, campaign_name, form_name, ad_name, platform from fresh
    on conflict (phone) where phone <> '' do nothing
    returning id, phone
  ), acts as (
    insert into leaddesk.activities (lead_id, type, text)
    select ins.id, 'created', fresh.note from ins join fresh using (phone)
    returning 1
  )
  select count(*) into v_added from acts;

  return query select v_added, v_total - v_added;
end;
$$;
