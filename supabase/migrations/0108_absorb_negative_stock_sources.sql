-- Material consumed before it was bought is traced to "No purchase on record". When the purchase (or a
-- transfer in) later covers that shortfall, the consumption now takes on everything about it: the vendor
-- bill, the vendor and the unit cost, so reports and the material's sources show the real vendor.
create or replace function public.absorb_uncosted_draws(p_txn public.inventory_transactions)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill uuid;
  v_text text;
  v_out uuid;
  v_left numeric;
  v_take numeric;
  v_d record;
begin
  if p_txn.quantity <= 0 or p_txn.txn_type not in ('purchase', 'transfer_in') then return; end if;

  if p_txn.txn_type = 'purchase' and p_txn.reference_type = 'supplier_bill' then
    v_bill := p_txn.reference_id;
  elsif p_txn.txn_type = 'transfer_in' then
    select id into v_out from public.inventory_transactions
      where reference_id = p_txn.reference_id and txn_type = 'transfer_out' and item_id = p_txn.item_id
      order by created_at limit 1;
    select vendor_bill_id, vendor_text into v_bill, v_text from public.inventory_lot_draws where txn_id = v_out order by id limit 1;
    if v_bill is null and v_text is null then v_text := 'Company purchase (no vendor)'; end if;
  else
    v_text := 'Company purchase (no vendor)';
  end if;

  v_left := p_txn.quantity;
  for v_d in
    select d.* from public.inventory_lot_draws d
    join public.inventory_transactions t on t.id = d.txn_id
    where t.item_id = p_txn.item_id and t.location_id = p_txn.location_id and t.txn_type = 'consumption'
      and t.reversed_by is null and t.created_at <= p_txn.created_at
      and d.vendor_text = 'No purchase on record' and d.vendor_bill_id is null
    order by t.created_at, d.id
    for update of d
  loop
    exit when v_left <= 0;
    v_take := least(v_d.quantity, v_left);
    if v_take < v_d.quantity then
      insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_bill_id, vendor_text)
        values (v_d.txn_id, v_d.lot_id, v_d.quantity - v_take, v_d.unit_cost, v_d.vendor_bill_id, v_d.vendor_text);
    end if;
    update public.inventory_lot_draws
      set quantity = v_take, unit_cost = p_txn.unit_cost, vendor_bill_id = v_bill, vendor_text = v_text
      where id = v_d.id;
    v_left := v_left - v_take;
  end loop;
end;
$function$;
revoke all on function public.absorb_uncosted_draws(public.inventory_transactions) from public, anon, authenticated;

create or replace function public.inventory_transactions_absorb_draws()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.absorb_uncosted_draws(new);
  return new;
end;
$function$;

drop trigger if exists inventory_transactions_z_absorb on public.inventory_transactions;
create trigger inventory_transactions_z_absorb after insert on public.inventory_transactions
  for each row when (new.quantity > 0 and new.txn_type in ('purchase', 'transfer_in'))
  execute function public.inventory_transactions_absorb_draws();

-- Consumption already on the books that was waiting for its purchase.
do $$
declare r public.inventory_transactions;
begin
  for r in select * from public.inventory_transactions
    where quantity > 0 and txn_type in ('purchase', 'transfer_in') and reversed_by is null order by created_at, id
  loop
    perform public.absorb_uncosted_draws(r);
  end loop;
end $$;
