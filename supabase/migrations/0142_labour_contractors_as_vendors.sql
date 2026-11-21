-- Labour contractors can bill too, and a bill's vendor must be a suppliers row (payables and
-- vendor payments hang off it). Each contractor gets a linked supplier that follows its name,
-- phone and active flag, so contractors appear in the bill vendor list, can be matched by the
-- bill scan, and carry payables like any vendor.
alter table public.suppliers
  add column if not exists labour_contractor_id uuid unique references public.labour_contractors(id) on delete set null;

create or replace function public.sync_labour_contractor_supplier()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.suppliers where labour_contractor_id = new.id;
  if v_id is not null then
    update public.suppliers
      set phone = coalesce(new.phone, phone), active = new.active, updated_at = now(),
          name = case when exists (select 1 from public.suppliers o where o.id <> v_id and lower(trim(o.name)) = lower(trim(new.name))) then name else new.name end
      where id = v_id;
    return new;
  end if;
  -- A vendor that already has this name becomes the contractor's vendor; otherwise make one.
  select id into v_id from public.suppliers
    where labour_contractor_id is null and lower(trim(name)) = lower(trim(new.name)) order by created_at limit 1;
  if v_id is not null then
    update public.suppliers set labour_contractor_id = new.id where id = v_id;
  else
    insert into public.suppliers (name, phone, notes, active, labour_contractor_id)
      values (new.name, new.phone, 'Labour contractor', new.active, new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_labour_contractor_supplier on public.labour_contractors;
create trigger trg_sync_labour_contractor_supplier
  after insert or update of name, phone, active on public.labour_contractors
  for each row execute function public.sync_labour_contractor_supplier();

revoke all on function public.sync_labour_contractor_supplier() from public, anon, authenticated;

-- Existing contractors.
update public.labour_contractors set name = name;
