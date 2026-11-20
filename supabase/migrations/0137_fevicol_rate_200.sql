-- FEVICOL job work is Rs.200 (was 256) for every client category, on every entry and issued bill,
-- old and new. Old values are kept in fevicol_rate_change_backup so this can be undone.
create table if not exists public.fevicol_rate_change_backup (
  kind text not null, row_id uuid not null, old_values jsonb not null, changed_at timestamptz not null default now()
);
alter table public.fevicol_rate_change_backup enable row level security;

do $$
declare
  svc uuid := (select id from public.job_work_services where name = 'FEVICOL');
  proc uuid := (select id from public.processes where name = 'FEVICOL');
begin
  if exists (select 1 from public.fevicol_rate_change_backup) then raise exception 'already applied'; end if;

  insert into public.fevicol_rate_change_backup select 'rate', id, to_jsonb(r) from public.rates r where job_work_service_id = svc and rate <> 200;
  insert into public.fevicol_rate_change_backup select 'component', c.id, to_jsonb(c) from public.job_work_entry_components c where c.process_id = proc and c.rate_value <> 200;
  insert into public.fevicol_rate_change_backup
    select 'entry', e.id, to_jsonb(e) from public.job_work_entries e where e.id in (select entry_id from public.job_work_entry_components where process_id = proc and rate_value <> 200);
  insert into public.fevicol_rate_change_backup
    select 'bill_item', bi.id, to_jsonb(bi) from public.bill_items bi where bi.job_work_entry_id in (select entry_id from public.job_work_entry_components where process_id = proc and rate_value <> 200);
  insert into public.fevicol_rate_change_backup
    select 'bill', b.id, to_jsonb(b) from public.bills b where b.id in (select bill_id from public.bill_items where job_work_entry_id in (select entry_id from public.job_work_entry_components where process_id = proc and rate_value <> 200));

  update public.rates set rate = 200 where job_work_service_id = svc;

  create temp table _fev_entries on commit drop as
    select distinct entry_id from public.job_work_entry_components where process_id = proc and rate_value <> 200;

  update public.job_work_entry_components set rate_value = 200, amount = round(component_quantity * 200, 2)
    where process_id = proc and rate_value <> 200;

  update public.job_work_entries e set total_amount = (select coalesce(sum(c.amount), 0) from public.job_work_entry_components c where c.entry_id = e.id)
    where e.id in (select entry_id from _fev_entries);

  update public.bill_items bi set amount = e.total_amount
    from public.job_work_entries e where e.id = bi.job_work_entry_id and e.id in (select entry_id from _fev_entries);

  update public.bills b set
    subtotal = (select coalesce(sum(amount), 0) from public.bill_items x where x.bill_id = b.id),
    tax_amount = round((select coalesce(sum(amount), 0) from public.bill_items x where x.bill_id = b.id) * b.tax_percent / 100, 2),
    grand_total = (select coalesce(sum(amount), 0) from public.bill_items x where x.bill_id = b.id)
      + round((select coalesce(sum(amount), 0) from public.bill_items x where x.bill_id = b.id) * b.tax_percent / 100, 2) + b.adjustments
  where b.id in (select bill_id from public.bill_items where job_work_entry_id in (select entry_id from _fev_entries));
end $$;
