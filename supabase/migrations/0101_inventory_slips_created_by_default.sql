-- The slip insert policy requires created_by = the signed-in user, but the slip form never sent it, so
-- every slip was refused ("new row violates row-level security policy"). The column now fills itself in.
alter table public.inventory_slips alter column created_by set default auth.uid();
