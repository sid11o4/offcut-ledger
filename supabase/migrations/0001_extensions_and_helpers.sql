-- Formgrid Factory: extensions and shared helper functions/triggers.

create extension if not exists pgcrypto;

-- Generic updated_at maintenance trigger, attached to every table with an updated_at column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Stamps updated_at = now() on every UPDATE. Attach as a BEFORE UPDATE trigger.';
