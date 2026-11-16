-- Stock lots: every inflow to a location is a lot, tagged with the vendor it came from. Every outflow
-- draws from the oldest lots at that location and records exactly what it drew. So each consumption knows
-- which vendor's material it used, as it happened. A transfer carries the lots it drew to its destination.
-- A shortfall is a negative lot, so later stock first settles it.

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  item_id uuid not null references public.inventory_items(id),
  location_id uuid not null references public.inventory_locations(id),
  vendor_bill_id uuid references public.supplier_bills(id),
  vendor_text text,
  unit_cost numeric(14,4) not null default 0,
  remaining numeric(14,4) not null,
  source_txn_id uuid references public.inventory_transactions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_lots_item_loc on public.inventory_lots(item_id, location_id, seq);

create table if not exists public.inventory_lot_draws (
  id bigserial primary key,
  txn_id uuid not null references public.inventory_transactions(id) on delete cascade,
  lot_id uuid references public.inventory_lots(id) on delete cascade,
  quantity numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  vendor_bill_id uuid references public.supplier_bills(id),
  vendor_text text
);
create index if not exists idx_inventory_lot_draws_txn on public.inventory_lot_draws(txn_id);

alter table public.inventory_lots enable row level security;
alter table public.inventory_lot_draws enable row level security;
revoke all on public.inventory_lots from public, anon, authenticated;
revoke all on public.inventory_lot_draws from public, anon, authenticated;
grant select on public.inventory_lots, public.inventory_lot_draws to authenticated;
create policy inventory_lots_read on public.inventory_lots for select to authenticated using (public.is_active_user());
create policy inventory_lot_draws_read on public.inventory_lot_draws for select to authenticated using (public.is_active_user());

create or replace function public.apply_lot_movement(p_txn public.inventory_transactions)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric;
  v_take numeric;
  v_lot record;
  v_out_id uuid;
  v_draw record;
  v_bill uuid;
  v_text text;
  v_new_lot uuid;
begin
  if p_txn.quantity > 0 then
    v_remaining := p_txn.quantity;
    -- Stock coming in first settles any shortfall at this location, oldest first.
    for v_lot in select * from public.inventory_lots
      where item_id = p_txn.item_id and location_id = p_txn.location_id and remaining < 0
      order by seq loop
      exit when v_remaining <= 0;
      v_take := least(-v_lot.remaining, v_remaining);
      update public.inventory_lots set remaining = remaining + v_take where id = v_lot.id;
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining <= 0 then return; end if;

    if p_txn.txn_type = 'transfer_in' then
      -- A transfer brings the same lots it drew at the source, so the vendor carries across.
      select id into v_out_id from public.inventory_transactions
        where reference_id = p_txn.reference_id and txn_type = 'transfer_out' and item_id = p_txn.item_id
        order by created_at limit 1;
      for v_draw in select * from public.inventory_lot_draws where txn_id = v_out_id order by id loop
        exit when v_remaining <= 0;
        v_take := least(v_draw.quantity, v_remaining);
        insert into public.inventory_lots (item_id, location_id, vendor_bill_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, v_draw.vendor_bill_id, v_draw.vendor_text, v_draw.unit_cost, v_take, p_txn.id);
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0 then
        insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)
          values (p_txn.item_id, p_txn.location_id, 'Transfer (no vendor on record)', p_txn.unit_cost, v_remaining, p_txn.id);
      end if;
    else
      v_bill := case when p_txn.reference_type = 'supplier_bill' then p_txn.reference_id end;
      v_text := case when v_bill is null then 'Company purchase (no vendor)' end;
      insert into public.inventory_lots (item_id, location_id, vendor_bill_id, vendor_text, unit_cost, remaining, source_txn_id)
        values (p_txn.item_id, p_txn.location_id, v_bill, v_text, p_txn.unit_cost, v_remaining, p_txn.id);
    end if;
  else
    v_remaining := -p_txn.quantity;
    for v_lot in select * from public.inventory_lots
      where item_id = p_txn.item_id and location_id = p_txn.location_id and remaining > 0
      order by seq loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.remaining, v_remaining);
      update public.inventory_lots set remaining = remaining - v_take where id = v_lot.id;
      insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_bill_id, vendor_text)
        values (p_txn.id, v_lot.id, v_take, v_lot.unit_cost, v_lot.vendor_bill_id, v_lot.vendor_text);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      -- Not enough stock: a negative lot records the shortfall until stock comes in to settle it.
      insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)
        values (p_txn.item_id, p_txn.location_id, 'No purchase on record', 0, -v_remaining, p_txn.id)
        returning id into v_new_lot;
      insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_text)
        values (p_txn.id, v_new_lot, v_remaining, 0, 'No purchase on record');
    end if;
  end if;
end;
$$;

revoke all on function public.apply_lot_movement(public.inventory_transactions) from public, anon, authenticated;

create or replace function public.inventory_transactions_apply_lots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_lot_movement(new);
  return new;
end;
$$;

revoke all on function public.inventory_transactions_apply_lots() from public, anon, authenticated;

drop trigger if exists inventory_transactions_apply_lots on public.inventory_transactions;
create trigger inventory_transactions_apply_lots
  after insert on public.inventory_transactions
  for each row execute function public.inventory_transactions_apply_lots();

-- Backfill: replay the existing movements in the order they happened, outflows of a transfer first.
do $$
declare r public.inventory_transactions;
begin
  delete from public.inventory_lot_draws;
  delete from public.inventory_lots;
  for r in select * from public.inventory_transactions order by created_at, quantity loop
    perform public.apply_lot_movement(r);
  end loop;
end $$;
