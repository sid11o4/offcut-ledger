create table public.offcut_inventory (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  length numeric not null,
  width numeric not null,
  bin text not null default 'A',
  qty numeric not null,
  created_at timestamptz not null default now()
);

create table public.offcut_unexposed_materials (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  thicknesses numeric[] not null,
  created_at timestamptz not null default now()
);

create table public.offcut_discard_rules (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  min_length numeric not null,
  min_width numeric not null,
  created_at timestamptz not null default now()
);

create table public.offcut_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  saved_at bigint not null,
  cutlist_file_name text,
  cutlist_fields jsonb,
  cutlist_rows jsonb,
  kerf numeric,
  matched jsonb,
  remaining jsonb,
  applied boolean,
  new_remnants jsonb,
  discarded_offcuts jsonb,
  origin_trim_rects jsonb,
  created_at timestamptz not null default now()
);

alter table public.offcut_inventory enable row level security;
alter table public.offcut_unexposed_materials enable row level security;
alter table public.offcut_discard_rules enable row level security;
alter table public.offcut_projects enable row level security;

-- This app has no auth layer (single-user internal tool), so grant the anon key full
-- CRUD on its own tables only. Anyone with the publishable key can read/write this data.
create policy "offcut_inventory_all" on public.offcut_inventory for all to anon using (true) with check (true);
create policy "offcut_unexposed_materials_all" on public.offcut_unexposed_materials for all to anon using (true) with check (true);
create policy "offcut_discard_rules_all" on public.offcut_discard_rules for all to anon using (true) with check (true);
create policy "offcut_projects_all" on public.offcut_projects for all to anon using (true) with check (true);

insert into public.offcut_unexposed_materials (material, thicknesses) values
  ('16.2_MR PLY_DEFAULT_MAT_DEFAULT_MAT', array[17.0, 18.0]);

insert into public.offcut_discard_rules (material, min_length, min_width) values
  ('17.0_MR PLY_DEFAULT_MAT_LIGHT BROWN CAMBRIC 6965 SUD', 330, 450);
