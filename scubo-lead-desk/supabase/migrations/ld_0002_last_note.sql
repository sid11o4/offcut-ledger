-- Denormalised "latest human note" on each lead, so the follow-up queue and CSV export
-- don't have to download every activity row.
alter table leaddesk.leads add column last_note text not null default '';

create or replace function leaddesk.activities_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update leaddesk.leads
     set updated_at = now(),
         last_contact_at = case when new.type = 'log' then now() else last_contact_at end,
         last_note = case when new.type in ('note', 'log') then new.text else last_note end
   where id = new.lead_id;
  return null;
end;
$$;
