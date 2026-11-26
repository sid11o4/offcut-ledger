-- A Design Build Order is Design Build paying the factory for job work, so the factory never waits on it:
-- the moment the entry is logged it is billed (one bill per project per day) and that bill is marked paid.
-- Billing is what takes the raw board / skins out of stock, so that now happens at logging time as well.
-- If billing cannot complete (for example the stock is short) the entry is left unbilled, as before, and
-- can be billed by hand once the stock is fixed; logging the work is never blocked.

create or replace function public.auto_bill_internal_entry(p_entry uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.job_work_entries;
  v_bill uuid;
  c_note constant text := 'Design Build Order: billed and paid automatically';
begin
  select * into e from public.job_work_entries where id = p_entry for update;
  if e.id is null or e.status <> 'active' or e.billed or coalesce(e.total_amount, 0) <= 0 then return null; end if;
  if not exists (select 1 from public.projects p join public.rate_categories rc on rc.id = p.rate_category_id
                 where p.id = e.project_id and rc.code = 'INTERNAL') then return null; end if;

  select id into v_bill from public.bills
    where project_id = e.project_id and status = 'issued' and notes = c_note and billing_period_start = e.entry_date
    order by created_at limit 1;
  if v_bill is null then
    insert into public.bills (client_id, project_id, billing_period_start, billing_period_end, status, payment_status,
        subtotal, tax_percent, tax_amount, gst_treatment, adjustments, grand_total, notes, created_by)
      values (e.client_id, e.project_id, e.entry_date, e.entry_date, 'issued', 'paid',
        0, 0, 0, 'full', 0, 0, c_note, coalesce(auth.uid(), e.created_by))
      returning id into v_bill;
  end if;

  insert into public.bill_items (bill_id, job_work_entry_id, service_id, entry_date, quantity, unit_id, amount)
    values (v_bill, e.id, e.service_id, e.entry_date, e.base_quantity, e.unit_id, e.total_amount);
  update public.bills set subtotal = subtotal + e.total_amount, grand_total = grand_total + e.total_amount where id = v_bill;
  return v_bill;
end $$;
revoke all on function public.auto_bill_internal_entry(uuid) from public, anon, authenticated;

create or replace function public.trg_auto_bill_internal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and not new.billed and coalesce(new.total_amount, 0) > 0 then
    begin
      perform public.auto_bill_internal_entry(new.id);
    exception when others then
      null; -- stays unbilled; billing can be done by hand
    end;
  end if;
  return null;
end $$;
revoke all on function public.trg_auto_bill_internal() from public, anon, authenticated;

drop trigger if exists trg_auto_bill_internal on public.job_work_entries;
create trigger trg_auto_bill_internal after insert or update of total_amount on public.job_work_entries
  for each row execute function public.trg_auto_bill_internal();

-- Already-issued Design Build Order bills are settled.
update public.bills b set payment_status = 'paid'
  from public.projects p join public.rate_categories rc on rc.id = p.rate_category_id
  where b.project_id = p.id and rc.code = 'INTERNAL' and b.status = 'issued' and b.payment_status <> 'paid';

-- Entries still unbilled are billed now.
do $$
declare r record;
begin
  for r in select e.id from public.job_work_entries e
    where e.status = 'active' and not e.billed and e.total_amount > 0 order by e.entry_date, e.created_at loop
    begin perform public.auto_bill_internal_entry(r.id); exception when others then raise notice 'entry % stays unbilled: %', r.id, sqlerrm; end;
  end loop;
end $$;
