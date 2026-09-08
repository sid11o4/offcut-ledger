-- Billing (spec sections 22-26, 46).
--
-- Assumption (documented): generate_bill() (0012) issues the bill immediately (status
-- 'issued') rather than leaving a separate manual 'draft' authoring step -- selecting entries
-- IS the drafting step in this UI. 'draft' remains a valid status for future manual-entry
-- bills and is not otherwise produced by the app today.

create sequence public.bill_number_seq;

create or replace function public.next_bill_number()
returns text
language sql
as $$
  select 'BILL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.bill_number_seq')::text, 5, '0');
$$;

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique default public.next_bill_number(),
  bill_date date not null default current_date,
  client_id uuid not null references public.clients(id),
  project_id uuid not null references public.projects(id),
  billing_period_start date,
  billing_period_end date,
  status text not null default 'draft'
    check (status in ('draft','issued','paid','partially_paid','cancelled')),
  subtotal numeric(14,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  adjustment_notes text,
  grand_total numeric(14,2) not null default 0,
  notes text,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text
);
create index idx_bills_project on public.bills(project_id);
create index idx_bills_client on public.bills(client_id);
create index idx_bills_status on public.bills(status);
create trigger trg_bills_updated_at before update on public.bills
  for each row execute function public.set_updated_at();

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  job_work_entry_id uuid not null references public.job_work_entries(id),
  service_id uuid not null references public.job_work_services(id),
  entry_date date not null,
  quantity numeric(14,4) not null,
  unit_id uuid not null references public.units(id),
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index idx_bill_items_bill on public.bill_items(bill_id);
create index idx_bill_items_entry on public.bill_items(job_work_entry_id);

alter table public.job_work_entries
  add constraint fk_entries_bill_item foreign key (bill_item_id) references public.bill_items(id);

-- The authoritative "not billed twice" guard: even a direct INSERT into bill_items (bypassing
-- generate_bill()) cannot succeed against an already-billed, active entry, because this lock
-- + check + flip happens atomically in the same statement. AFTER INSERT (not BEFORE): the
-- entries.bill_item_id FK must point at a bill_items row that already exists, which is only
-- true once this row has actually been written; raising here still rolls back the insert too.
create or replace function public.bill_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billed boolean;
  v_status text;
begin
  select billed, status into v_billed, v_status
  from public.job_work_entries
  where id = new.job_work_entry_id
  for update;

  if v_status is null then
    raise exception 'Job-work entry % does not exist.', new.job_work_entry_id;
  end if;
  if v_status <> 'active' then
    raise exception 'Cannot bill a cancelled job-work entry.';
  end if;
  if v_billed then
    raise exception 'Job-work entry % is already billed.', new.job_work_entry_id;
  end if;

  update public.job_work_entries
    set billed = true, bill_item_id = new.id
    where id = new.job_work_entry_id;

  return new;
end;
$$;

create or replace trigger trg_bill_items_after_insert
  after insert on public.bill_items
  for each row execute function public.bill_items_after_insert();

-- Cancelling a bill frees its entries back to unbilled (spec section 24/46).
create or replace function public.bills_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.job_work_entries
      set billed = false, bill_item_id = null
      where id in (select job_work_entry_id from public.bill_items where bill_id = new.id);
  end if;
  return new;
end;
$$;

create trigger trg_bills_after_update
  after update on public.bills
  for each row execute function public.bills_after_update();
