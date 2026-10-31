-- Inventory for Formgrid Design Build (business context, Oct 2026):
-- Two pools per the owner's spec -- a single shared "company" pool and one pool per Design
-- Build project -- with one material master (no duplicate catalogs) and a signed, append-only
-- transaction ledger as the only source of truth. inventory_stock is a maintained summary,
-- never written directly (same pattern as job_work_entry_components / rates history elsewhere
-- in this app): every balance change is one row in inventory_transactions.
--
-- Rules encoded here:
--  * Only materials at or above Rs.50/unit get stock-level tracking; cheaper items still show
--    up as an expense (via supplier_bill_items in a later migration) but never get a stock row.
--  * A transfer moves BOTH quantity and cost from the source location to the destination (two
--    ledger rows, one transfer_group_id) -- "the transfer also transfers the cost".
--  * Anything entered into a project's own inventory (direct purchase, or a transfer in) is
--    already that project's cost from that moment; consuming it doesn't move cost again.
--  * Consumption draws from the project's own stock first; record_inventory_consumption()
--    raises a company-to-project transfer automatically only for the shortfall.

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  unit_id uuid not null references public.units(id),
  category text,
  default_rate numeric(12,2),
  -- Auto-set true once default_rate >= 50 (trigger below); an admin may also set it by hand.
  -- Never auto-cleared: a temporary price dip shouldn't silently stop stock tracking mid-stream.
  track_as_inventory boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index idx_inventory_items_name_trgm on public.inventory_items using gin (name gin_trgm_ops);
create trigger trg_inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();

create or replace function public.inventory_items_set_tracking()
returns trigger language plpgsql as $$
begin
  if coalesce(new.default_rate, 0) >= 50 then
    new.track_as_inventory := true;
  end if;
  return new;
end;
$$;
create trigger trg_inventory_items_tracking before insert or update of default_rate
  on public.inventory_items for each row execute function public.inventory_items_set_tracking();

-- Exactly one company-pool location, plus one per Design Build project (auto-created below).
create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('company','project')),
  design_project_id uuid references public.design_projects(id),
  name text not null,
  created_at timestamptz not null default now(),
  constraint chk_location_project check (
    (kind = 'company' and design_project_id is null) or
    (kind = 'project' and design_project_id is not null)
  )
);
create unique index uq_inventory_location_company on public.inventory_locations((kind)) where kind = 'company';
create unique index uq_inventory_location_project on public.inventory_locations(design_project_id) where kind = 'project';

insert into public.inventory_locations (kind, name) values ('company', 'Company Inventory');

create or replace function public.design_projects_create_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory_locations (kind, design_project_id, name)
  values ('project', new.id, new.name || ' — Project Inventory');
  return new;
end;
$$;
create trigger trg_design_projects_create_location after insert on public.design_projects
  for each row execute function public.design_projects_create_location();

create table public.inventory_stock (
  location_id uuid not null references public.inventory_locations(id),
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,4) not null default 0,
  avg_unit_cost numeric(12,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (location_id, item_id)
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_type text not null check (txn_type in ('purchase','transfer_out','transfer_in','consumption','adjustment')),
  item_id uuid not null references public.inventory_items(id),
  location_id uuid not null references public.inventory_locations(id),
  quantity numeric(14,4) not null, -- signed: positive = stock in, negative = stock out
  unit_cost numeric(12,4) not null default 0,
  total_cost numeric(14,2) not null default 0,
  txn_date date not null default current_date,
  transfer_group_id uuid,
  reference_type text not null check (reference_type in
    ('supplier_bill','manual_slip','internal_order','adjustment')),
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_inventory_txn_item_location on public.inventory_transactions(item_id, location_id);
create index idx_inventory_txn_transfer_group on public.inventory_transactions(transfer_group_id);
create index idx_inventory_txn_reference on public.inventory_transactions(reference_type, reference_id);

-- The only writer of inventory_stock. Posts one ledger row and keeps the moving-average cost:
-- an inflow blends in at its own unit_cost; an outflow is costed at the location's current
-- average (so the value that leaves is always what's actually on the books there) and never
-- changes the average itself. Raises if an outflow would take a balance negative.
create or replace function public.record_inventory_transaction(
  p_txn_type text, p_item_id uuid, p_location_id uuid, p_quantity numeric,
  p_unit_cost numeric, p_txn_date date, p_reference_type text, p_reference_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
  v_current record;
  v_new_qty numeric;
  v_new_avg numeric;
  v_effective_unit_cost numeric;
  v_total_cost numeric;
begin
  if not public.is_active_user() then
    raise exception 'Your account is inactive.';
  end if;
  if p_quantity = 0 then
    raise exception 'Transaction quantity cannot be zero.';
  end if;

  select quantity, avg_unit_cost into v_current
  from public.inventory_stock where location_id = p_location_id and item_id = p_item_id
  for update;
  if not found then
    insert into public.inventory_stock (location_id, item_id, quantity, avg_unit_cost)
    values (p_location_id, p_item_id, 0, 0);
    v_current.quantity := 0;
    v_current.avg_unit_cost := 0;
  end if;

  if p_quantity > 0 then
    v_effective_unit_cost := coalesce(p_unit_cost, 0);
    v_new_qty := v_current.quantity + p_quantity;
    v_new_avg := case when v_new_qty = 0 then 0
      else ((v_current.quantity * v_current.avg_unit_cost) + (p_quantity * v_effective_unit_cost)) / v_new_qty end;
  else
    if v_current.quantity + p_quantity < -0.0001 then
      raise exception 'Not enough stock: % available, % requested at this location.',
        v_current.quantity, -p_quantity;
    end if;
    v_effective_unit_cost := v_current.avg_unit_cost;
    v_new_qty := v_current.quantity + p_quantity;
    v_new_avg := v_current.avg_unit_cost; -- an outflow never changes the average
  end if;
  v_total_cost := round(p_quantity * v_effective_unit_cost, 2);

  insert into public.inventory_transactions
    (txn_type, item_id, location_id, quantity, unit_cost, total_cost, txn_date,
     reference_type, reference_id, notes, created_by)
  values
    (p_txn_type, p_item_id, p_location_id, p_quantity, v_effective_unit_cost, v_total_cost, p_txn_date,
     p_reference_type, p_reference_id, p_notes, auth.uid())
  returning id into v_txn_id;

  update public.inventory_stock
    set quantity = v_new_qty, avg_unit_cost = v_new_avg, updated_at = now()
    where location_id = p_location_id and item_id = p_item_id;

  return v_txn_id;
end;
$$;

-- A direct purchase into a location (company or a specific project). Per spec, material
-- entered straight into a project's inventory is that project's cost immediately.
create or replace function public.record_inventory_purchase(
  p_item_id uuid, p_location_id uuid, p_quantity numeric, p_unit_cost numeric,
  p_txn_date date, p_reference_type text default 'supplier_bill', p_reference_id uuid default null,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_quantity <= 0 then raise exception 'Purchase quantity must be greater than zero.'; end if;
  return public.record_inventory_transaction(
    'purchase', p_item_id, p_location_id, p_quantity, p_unit_cost, p_txn_date,
    p_reference_type, p_reference_id, p_notes);
end;
$$;

-- Any-to-any transfer: two ledger rows sharing one transfer_group_id, at the SAME unit_cost,
-- so the cost moves with the stock exactly as specified.
create or replace function public.record_inventory_transfer(
  p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric,
  p_txn_date date default current_date, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid := gen_random_uuid();
  v_from_cost numeric;
begin
  if p_quantity <= 0 then raise exception 'Transfer quantity must be greater than zero.'; end if;
  if p_from_location_id = p_to_location_id then raise exception 'Source and destination must differ.'; end if;

  select avg_unit_cost into v_from_cost from public.inventory_stock
  where location_id = p_from_location_id and item_id = p_item_id;
  v_from_cost := coalesce(v_from_cost, 0);

  perform public.record_inventory_transaction(
    'transfer_out', p_item_id, p_from_location_id, -p_quantity, v_from_cost, p_txn_date,
    'manual_slip', v_group_id, p_notes);
  perform public.record_inventory_transaction(
    'transfer_in', p_item_id, p_to_location_id, p_quantity, v_from_cost, p_txn_date,
    'manual_slip', v_group_id, p_notes);

  update public.inventory_transactions set transfer_group_id = v_group_id
    where reference_id = v_group_id and transfer_group_id is null;

  return v_group_id;
end;
$$;

-- Consumption against a project's own stock. Per spec: draw from the project's inventory
-- first; only when that's short does it raise a company->project transfer for the shortfall
-- (never the reverse -- a true stockout at the company pool too is a real error, not silently
-- swallowed, since that means more needs to be purchased).
create or replace function public.record_inventory_consumption(
  p_item_id uuid, p_design_project_id uuid, p_quantity numeric, p_txn_date date default current_date,
  p_reference_type text default 'manual_slip', p_reference_id uuid default null, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_project_location uuid;
  v_company_location uuid;
  v_project_qty numeric;
  v_company_qty numeric;
  v_shortfall numeric;
begin
  if p_quantity <= 0 then raise exception 'Consumption quantity must be greater than zero.'; end if;

  select id into v_project_location from public.inventory_locations
    where kind = 'project' and design_project_id = p_design_project_id;
  if v_project_location is null then raise exception 'No inventory location for this project.'; end if;
  select id into v_company_location from public.inventory_locations where kind = 'company';

  select coalesce(quantity, 0) into v_project_qty from public.inventory_stock
    where location_id = v_project_location and item_id = p_item_id;
  v_project_qty := coalesce(v_project_qty, 0);

  if v_project_qty < p_quantity then
    v_shortfall := p_quantity - v_project_qty;
    select coalesce(quantity, 0) into v_company_qty from public.inventory_stock
      where location_id = v_company_location and item_id = p_item_id;
    if coalesce(v_company_qty, 0) < v_shortfall then
      raise exception 'Not enough stock to consume: % short at project, and only % available in company inventory. Purchase more before recording this consumption.',
        v_shortfall, coalesce(v_company_qty, 0);
    end if;
    perform public.record_inventory_transfer(
      p_item_id, v_company_location, v_project_location, v_shortfall, p_txn_date,
      'Auto-transfer to cover consumption shortfall.');
  end if;

  return public.record_inventory_transaction(
    'consumption', p_item_id, v_project_location, -p_quantity, null, p_txn_date,
    p_reference_type, p_reference_id, p_notes);
end;
$$;

grant execute on function
  public.record_inventory_purchase(uuid, uuid, numeric, numeric, date, text, uuid, text),
  public.record_inventory_transfer(uuid, uuid, uuid, numeric, date, text),
  public.record_inventory_consumption(uuid, uuid, numeric, date, text, uuid, text)
to authenticated;
