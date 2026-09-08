-- Roles, granular permissions, and per-user profiles.
--
-- Assumption (documented): the ROLE SET is fixed to the four roles named in the spec
-- (admin, manager, staff, accounts) rather than fully dynamic role creation. What IS
-- configurable without code changes is which permissions each role holds, via
-- role_permissions, edited from Users & Permissions by an admin.

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  key text primary key,
  label text not null,
  description text
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  allowed boolean not null default false,
  primary key (role_id, permission_key)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role_id uuid references public.roles(id),
  active boolean not null default true,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile row whenever a new auth user is created, defaulting to
-- the 'staff' role (least privilege) until an admin assigns something else.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_role_id uuid;
begin
  select id into v_staff_role_id from public.roles where key = 'staff';

  insert into public.profiles (id, full_name, email, role_id, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    v_staff_role_id,
    true
  )
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- has_permission: true only if the caller is an active user whose role grants perm_key.
create or replace function public.has_permission(perm_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select rp.allowed
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id and rp.permission_key = perm_key
      where p.id = auth.uid() and p.active = true
    ),
    false
  );
$$;

comment on function public.has_permission(text) is
  'Central authorization check used by RLS policies and RPC functions. False for inactive/unknown users.';

create or replace function public.current_role_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.key
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.active = true;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true);
$$;
