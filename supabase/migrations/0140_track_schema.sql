-- FORMGRID Track (track.formgrid.in): site-progress tracking, rebuilt inside the factory database.
-- Everything is prefixed track_ so it cannot collide with factory tables.
--
-- Access model
--   * Track members (track_members) sign in with their normal Supabase Auth account. Role admin
--     manages structure (projects, rooms, BOQ, categories, members); site_team logs progress,
--     reports, photos and material requests.
--   * Factory (factory.formgrid.in) users are active users of the factory app (is_active_user()).
--     They get SELECT only on every track_ table. No factory policy grants any write.
--   * Material requests read live stock through track_inventory_catalog(); Track never gets a
--     direct grant on inventory tables.

create table public.track_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'site_team')),
  created_at timestamptz not null default now()
);

create or replace function public.track_role() returns text
language sql security definer stable set search_path = public as $$
  select role from public.track_members where user_id = auth.uid();
$$;
create or replace function public.track_is_member() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.track_members where user_id = auth.uid());
$$;
create or replace function public.track_is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select role from public.track_members where user_id = auth.uid()) = 'admin', false);
$$;
-- Read access: Track members, plus active factory users (read-only).
create or replace function public.track_can_read() returns boolean
language sql security definer stable set search_path = public as $$
  select public.track_is_member() or public.is_active_user();
$$;

create table public.track_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  location text,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed')),
  -- Links the site project to its Design Build project so the factory dashboard and the material
  -- request inventory line up. Nullable; at most one site project per Design Build project.
  design_project_id uuid unique references public.design_projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.track_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  weight numeric not null default 1 check (weight >= 0),
  has_polish boolean not null default false,
  tasks jsonb not null default '[]',            -- [{"name": text, "points": number}]
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.track_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.track_projects(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table public.track_boq_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.track_projects(id) on delete cascade,
  room_id uuid not null references public.track_rooms(id) on delete cascade,
  category_id uuid not null references public.track_categories(id) on delete restrict,
  title text not null,
  sqft numeric not null default 0 check (sqft >= 0),
  polish text not null default 'No' check (polish in ('Yes', 'No')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index track_boq_items_project_idx on public.track_boq_items(project_id);

-- Per-task completion (0-100) in the same order as the category's tasks, polish last.
create table public.track_boq_progress (
  boq_item_id uuid primary key references public.track_boq_items(id) on delete cascade,
  progress jsonb not null default '[]',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create or replace function public.track_create_boq_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.track_boq_progress (boq_item_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger track_boq_items_after_insert after insert on public.track_boq_items
  for each row execute function public.track_create_boq_progress();

-- One row per project per day. start_state is the BOQ progress when the day was started, so the
-- end-of-day report can show exactly what moved.
create table public.track_daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.track_projects(id) on delete cascade,
  report_date date not null,
  start_state jsonb not null default '{}',      -- {boq_item_id: [progress...]}
  start_pct numeric not null default 0,
  end_state jsonb,
  end_pct numeric,
  next_day_plan text not null default '',
  issues text not null default '',
  materials jsonb not null default '[]',        -- [{name, qty, unit, status}]
  labour jsonb not null default '[]',           -- [{trade, count, hours}]
  started_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, report_date)
);

create table public.track_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.track_projects(id) on delete cascade,
  report_date date not null,
  storage_path text not null,
  caption text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Material requests: from inventory (item_id) or outside it (free_text_name).
create table public.track_material_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.track_projects(id) on delete cascade,
  needed_by date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'fulfilled', 'rejected', 'cancelled')),
  note text,
  response_note text,
  requested_by uuid references auth.users(id) default auth.uid(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.track_material_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.track_material_requests(id) on delete cascade,
  item_id uuid references public.inventory_items(id),
  free_text_name text,
  quantity numeric not null check (quantity > 0),
  unit_text text,
  check (item_id is not null or coalesce(trim(free_text_name), '') <> '')
);
create index track_material_request_items_req_idx on public.track_material_request_items(request_id);

-- ---------------------------------------------------------------- row-level security
do $$
declare t text;
begin
  foreach t in array array['track_members','track_projects','track_categories','track_rooms','track_boq_items',
    'track_boq_progress','track_daily_reports','track_photos','track_material_requests','track_material_request_items']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reads: members and (read-only) factory users.
create policy track_projects_read on public.track_projects for select to authenticated using (public.track_can_read());
create policy track_categories_read on public.track_categories for select to authenticated using (public.track_can_read());
create policy track_rooms_read on public.track_rooms for select to authenticated using (public.track_can_read());
create policy track_boq_items_read on public.track_boq_items for select to authenticated using (public.track_can_read());
create policy track_boq_progress_read on public.track_boq_progress for select to authenticated using (public.track_can_read());
create policy track_daily_reports_read on public.track_daily_reports for select to authenticated using (public.track_can_read());
create policy track_photos_read on public.track_photos for select to authenticated using (public.track_can_read());
create policy track_requests_read on public.track_material_requests for select to authenticated using (public.track_can_read());
create policy track_request_items_read on public.track_material_request_items for select to authenticated using (public.track_can_read());
create policy track_members_read on public.track_members for select to authenticated
  using (user_id = auth.uid() or public.track_is_admin());

-- Structure: admins only.
create policy track_projects_admin on public.track_projects for all to authenticated
  using (public.track_is_admin()) with check (public.track_is_admin());
create policy track_categories_admin on public.track_categories for all to authenticated
  using (public.track_is_admin()) with check (public.track_is_admin());
create policy track_rooms_admin on public.track_rooms for all to authenticated
  using (public.track_is_admin()) with check (public.track_is_admin());
create policy track_boq_items_admin on public.track_boq_items for all to authenticated
  using (public.track_is_admin()) with check (public.track_is_admin());
create policy track_members_admin on public.track_members for all to authenticated
  using (public.track_is_admin()) with check (public.track_is_admin());

-- Site work: any member.
create policy track_boq_progress_write on public.track_boq_progress for update to authenticated
  using (public.track_is_member()) with check (public.track_is_member());
create policy track_daily_reports_insert on public.track_daily_reports for insert to authenticated
  with check (public.track_is_member());
create policy track_daily_reports_update on public.track_daily_reports for update to authenticated
  using (public.track_is_member()) with check (public.track_is_member());
create policy track_photos_insert on public.track_photos for insert to authenticated
  with check (public.track_is_member());
create policy track_photos_delete on public.track_photos for delete to authenticated
  using (public.track_is_admin() or created_by = auth.uid());

-- Requests: a member raises and may cancel their own; only Track admins decide.
create policy track_requests_insert on public.track_material_requests for insert to authenticated
  with check (public.track_is_member() and requested_by = auth.uid());
create policy track_requests_update on public.track_material_requests for update to authenticated
  using (public.track_is_admin() or (requested_by = auth.uid() and status = 'requested'))
  with check (public.track_is_admin() or (requested_by = auth.uid() and status in ('requested', 'cancelled')));
create policy track_request_items_insert on public.track_material_request_items for insert to authenticated
  with check (exists (select 1 from public.track_material_requests r
    where r.id = request_id and r.requested_by = auth.uid() and r.status = 'requested') or public.track_is_admin());
create policy track_request_items_delete on public.track_material_request_items for delete to authenticated
  using (exists (select 1 from public.track_material_requests r
    where r.id = request_id and r.status = 'requested' and (r.requested_by = auth.uid() or public.track_is_admin())));

-- ---------------------------------------------------------------- photos bucket (private)
insert into storage.buckets (id, name, public) values ('track-photos', 'track-photos', false)
  on conflict (id) do nothing;
create policy track_photos_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'track-photos' and public.track_can_read());
create policy track_photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'track-photos' and public.track_is_member());
create policy track_photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'track-photos' and public.track_is_member());

-- ---------------------------------------------------------------- default categories
insert into public.track_categories (name, weight, has_polish, tasks, is_default, sort_order) values
  ('Cabinetry', 1.0, true, '[{"name":"Cutlist generation","points":5},{"name":"Pasting & cutting","points":15},{"name":"Edge banding","points":10},{"name":"Transport to site","points":5},{"name":"Carcass assembly","points":20},{"name":"Shelves assembly","points":10},{"name":"Shutter pasting & cutting","points":20},{"name":"Shutter edge banding","points":10},{"name":"Handles & accessories","points":5}]', true, 1),
  ('Panelling', 0.5, true, '[{"name":"Raw board installation","points":50},{"name":"Lamination","points":50}]', true, 2),
  ('Gypsum Ceiling', 0.5, false, '[{"name":"Channel installation","points":40},{"name":"Wiring","points":20},{"name":"Board installation","points":20},{"name":"Painting","points":20}]', true, 3),
  ('Wooden Ceiling', 0.667, true, '[{"name":"Frame installation","points":30},{"name":"Raw board installation","points":35},{"name":"Lamination","points":35}]', true, 4),
  ('Loft', 0.667, true, '[{"name":"Frame assembly","points":40},{"name":"Shutter pasting & cutting","points":30},{"name":"Shutter edge banding","points":20},{"name":"Handles & accessories","points":10}]', true, 5)
on conflict (name) do nothing;

create or replace function public.track_protect_default_category() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_default then raise exception 'Default category "%" cannot be deleted.', old.name; end if;
    return old;
  end if;
  if old.is_default and (new.name <> old.name or new.is_default is distinct from true) then
    raise exception 'Default category "%" cannot be renamed or un-defaulted.', old.name;
  end if;
  return new;
end $$;
create trigger track_protect_default_category before update or delete on public.track_categories
  for each row execute function public.track_protect_default_category();

-- ---------------------------------------------------------------- progress (same maths as the old app)
-- Item % = sum(task points * done%) / sum(points); polish adds a task worth base/9 when the item
-- is polished. Item weight = sqft * category weight. Room / overall % are weight-averaged.
create or replace function public.track_item_progress(p_project uuid)
returns table (item_id uuid, room_id uuid, weight numeric, pct numeric)
language sql stable security definer set search_path = public as $$
  with it as (
    select b.id item_id, b.room_id, b.sqft, b.polish, c.weight cw, c.has_polish, c.tasks,
           coalesce(p.progress, '[]'::jsonb) prog
    from public.track_boq_items b
    join public.track_categories c on c.id = b.category_id
    left join public.track_boq_progress p on p.boq_item_id = b.id
    where b.project_id = p_project and public.track_can_read()
  ), tk as (
    select it.item_id, (x.ord - 1)::int idx, (x.e ->> 'points')::numeric pts
    from it cross join lateral jsonb_array_elements(it.tasks) with ordinality x(e, ord)
    union all
    select it.item_id, jsonb_array_length(it.tasks),
           (select coalesce(sum((e ->> 'points')::numeric), 0) from jsonb_array_elements(it.tasks) e) / 9
    from it where it.has_polish and it.polish = 'Yes'
  ), agg as (
    select it.item_id,
           sum(tk.pts) total,
           sum(tk.pts * coalesce((it.prog ->> tk.idx)::numeric, 0) / 100) done
    from it join tk on tk.item_id = it.item_id group by it.item_id
  )
  select it.item_id, it.room_id, it.sqft * it.cw,
         case when coalesce(a.total, 0) > 0 then a.done / a.total else 0 end
  from it left join agg a on a.item_id = it.item_id;
$$;

-- Everything the factory dashboard needs, keyed by Design Build project. Read-only.
create or replace function public.track_progress_for_design_project(p_design_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_project uuid;
  v_overall numeric;
  v_rooms jsonb;
  v_last date;
  v_open int;
begin
  if not public.track_can_read() then raise exception 'Not allowed'; end if;
  select id into v_project from public.track_projects where design_project_id = p_design_project;
  if v_project is null then return null; end if;

  select case when sum(weight) > 0 then sum(pct * weight) / sum(weight) else 0 end
    into v_overall from public.track_item_progress(v_project);

  select coalesce(jsonb_agg(jsonb_build_object('room', r.name, 'pct', coalesce(x.pct, 0)) order by r.sort_order, r.name), '[]')
    into v_rooms
  from public.track_rooms r
  left join (
    select room_id, case when sum(weight) > 0 then sum(pct * weight) / sum(weight) else 0 end pct
    from public.track_item_progress(v_project) group by room_id
  ) x on x.room_id = r.id
  where r.project_id = v_project;

  select max(report_date) into v_last from public.track_daily_reports where project_id = v_project;
  select count(*) into v_open from public.track_material_requests
    where project_id = v_project and status in ('requested', 'approved');

  return jsonb_build_object('track_project_id', v_project, 'overall_pct', coalesce(v_overall, 0),
    'rooms', v_rooms, 'last_report_date', v_last, 'open_material_requests', v_open);
end $$;

-- ---------------------------------------------------------------- live inventory for requests
-- Company stock plus the project's own stock, per item. Read-only.
create or replace function public.track_inventory_catalog(p_track_project uuid)
returns table (item_id uuid, name text, unit text, category text, company_qty numeric, project_qty numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, u.code, i.category,
    coalesce(sum(s.quantity) filter (where l.kind = 'company'), 0),
    coalesce(sum(s.quantity) filter (where l.kind = 'project'
      and l.design_project_id = (select design_project_id from public.track_projects where id = p_track_project)), 0)
  from public.inventory_items i
  left join public.units u on u.id = i.unit_id
  left join public.inventory_stock s on s.item_id = i.id
  left join public.inventory_locations l on l.id = s.location_id
  where i.active and i.track_as_inventory and public.track_can_read()
  group by i.id, i.name, u.code, i.category
  order by i.name;
$$;

-- ---------------------------------------------------------------- members
-- An admin gives an existing account (created in the factory app's user management) Track access.
create or replace function public.track_set_member(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  -- The first admin is inserted by hand (see track/README.md); after that only admins add members.
  if not public.track_is_admin() then raise exception 'Only Track admins can manage members'; end if;
  if p_role not in ('admin', 'site_team') then raise exception 'Role must be admin or site_team'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'No account for %. Create it in the factory app first.', p_email; end if;
  insert into public.track_members (user_id, email, role) values (v_user, lower(trim(p_email)), p_role)
    on conflict (user_id) do update set role = excluded.role;
end $$;
create or replace function public.track_remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.track_is_admin() then raise exception 'Only Track admins can manage members'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  delete from public.track_members where user_id = p_user;
end $$;

revoke all on function public.track_set_member(text, text), public.track_remove_member(uuid) from public, anon;
grant execute on function public.track_set_member(text, text), public.track_remove_member(uuid),
  public.track_item_progress(uuid), public.track_progress_for_design_project(uuid),
  public.track_inventory_catalog(uuid), public.track_role() to authenticated;
revoke all on function public.track_item_progress(uuid), public.track_progress_for_design_project(uuid),
  public.track_inventory_catalog(uuid) from public, anon;
