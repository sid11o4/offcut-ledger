-- "Change admin" support (requested). Two parts:
--   * The existing prevent_self_role_escalation trigger already let a user WITH user_manage
--     change their own role/active (the block was only in the UI). Keep that -- an admin can
--     now step themselves down or hand admin to another user.
--   * But add a hard safety net: nobody, admin included, may remove the LAST active admin --
--     whether by demoting them to another role or by deactivating them. This makes it safe to
--     un-gate self-demotion in the UI (you just have to promote someone else to admin first).
-- (Changing a user's email is done by the manage-user Edge Function, not here.)

create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Non-admins still cannot touch their own role or active status at all.
  if auth.uid() = old.id and not public.has_permission('user_manage') then
    if new.role_id is distinct from old.role_id or new.active is distinct from old.active then
      raise exception 'You cannot change your own role or active status.';
    end if;
  end if;

  -- The last active admin cannot be demoted or deactivated (by anyone, including themselves).
  if old.active
     and old.role_id = (select id from public.roles where key = 'admin')
     and (new.role_id is distinct from old.role_id or new.active = false)
     and not exists (
       select 1
       from public.profiles p
       join public.roles r on r.id = p.role_id
       where r.key = 'admin' and p.active and p.id <> old.id
     )
  then
    raise exception 'This is the last active admin. Promote another user to admin before changing this one.';
  end if;

  return new;
end;
$$;
