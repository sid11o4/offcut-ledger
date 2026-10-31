-- Manual Consumption/Transfer Slip (business context, Oct 2026): the second of the two
-- consumption-reporting modes the owner specified -- the automatic one is the Internal Order
-- bridge (0029); this is the paper-slip-style manual report for everything else (site
-- consumption not tied to a factory job-work entry, or a manual stock transfer). One header
-- with one or more line items; each line posts straight through record_inventory_consumption()
-- or record_inventory_transfer() so it follows the exact same rules (project-stock-first,
-- cost-follows-transfer) as every other inventory movement.

create sequence public.inventory_slip_number_seq;

create or replace function public.next_inventory_slip_number()
returns text language sql as $$
  select 'SLIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.inventory_slip_number_seq')::text, 5, '0');
$$;

create table public.inventory_slips (
  id uuid primary key default gen_random_uuid(),
  slip_number text not null unique default public.next_inventory_slip_number(),
  slip_date date not null default current_date,
  slip_type text not null check (slip_type in ('consumption','transfer')),
  design_project_id uuid references public.design_projects(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_inventory_slips_project on public.inventory_slips(design_project_id);

create table public.inventory_slip_items (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.inventory_slips(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,4) not null check (quantity > 0),
  from_location_id uuid references public.inventory_locations(id), -- transfer only
  to_location_id uuid references public.inventory_locations(id), -- transfer only
  transfer_group_id uuid,
  inventory_txn_id uuid references public.inventory_transactions(id),
  created_at timestamptz not null default now()
);
create index idx_inventory_slip_items_slip on public.inventory_slip_items(slip_id);

-- Posts every line of a slip as real inventory movements and records which transaction(s)
-- each line produced, so the slip stays a readable, auditable front door onto the ledger
-- rather than a second source of truth.
create or replace function public.post_inventory_slip(p_slip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip record;
  v_item record;
  v_txn_id uuid;
  v_group_id uuid;
begin
  select * into v_slip from public.inventory_slips where id = p_slip_id;
  if v_slip.id is null then raise exception 'Slip not found.'; end if;

  for v_item in select * from public.inventory_slip_items where slip_id = p_slip_id and inventory_txn_id is null loop
    if v_slip.slip_type = 'consumption' then
      if v_slip.design_project_id is null then
        raise exception 'A consumption slip must be against a Design Build project.';
      end if;
      v_txn_id := public.record_inventory_consumption(
        v_item.item_id, v_slip.design_project_id, v_item.quantity, v_slip.slip_date,
        'manual_slip', p_slip_id, 'Manual consumption slip ' || v_slip.slip_number);
      update public.inventory_slip_items set inventory_txn_id = v_txn_id where id = v_item.id;
    else
      if v_item.from_location_id is null or v_item.to_location_id is null then
        raise exception 'A transfer slip line needs both a source and destination location.';
      end if;
      v_group_id := public.record_inventory_transfer(
        v_item.item_id, v_item.from_location_id, v_item.to_location_id, v_item.quantity, v_slip.slip_date,
        'Manual transfer slip ' || v_slip.slip_number);
      update public.inventory_slip_items set transfer_group_id = v_group_id where id = v_item.id;
    end if;
  end loop;
end;
$$;

grant execute on function public.post_inventory_slip(uuid) to authenticated;
