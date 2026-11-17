-- A purchase entry can be reversed even when part of it has been used. What was used goes back into negative
-- stock: the quantity is short again, the consumption is no longer costed by the reversed purchase, and it is
-- costed (with its vendor) again when the right purchase is entered, as for any material used before it was bought.

-- Reversals may take the balance below zero.
do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.record_inventory_transaction(text, uuid, uuid, numeric, numeric, date, text, uuid, text)'::regprocedure);
  d2 := replace(d, '(p_reference_type = ''manual_slip'' and p_txn_type = ''consumption''))',
    '(p_reference_type = ''manual_slip'' and p_txn_type = ''consumption'') or (p_txn_type = ''adjustment'' and (p_notes like ''Reversal:%'' or p_notes like ''Reversed:%'')))');
  if d2 = d then raise exception 'marker not found in record_inventory_transaction'; end if;
  execute d2;
end $$;

-- Taking a purchase's stock back removes that purchase's own stock first; whatever was already used becomes short.
do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.apply_lot_movement(public.inventory_transactions)'::regprocedure);
  d2 := replace(d, E'  else\n    v_remaining := -p_txn.quantity;',
E'  else\n    if p_txn.txn_type = ''adjustment'' and p_txn.reference_id is not null\n       and exists (select 1 from public.inventory_transactions s where s.id = p_txn.reference_id and s.txn_type = ''purchase'' and s.item_id = p_txn.item_id) then\n      v_remaining := -p_txn.quantity;\n      for v_lot in select * from public.inventory_lots where source_txn_id = p_txn.reference_id and remaining > 0 order by seq loop\n        exit when v_remaining <= 0;\n        v_take := least(v_lot.remaining, v_remaining);\n        update public.inventory_lots set remaining = remaining - v_take where id = v_lot.id;\n        insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_bill_id, vendor_text)\n          values (p_txn.id, v_lot.id, v_take, v_lot.unit_cost, v_lot.vendor_bill_id, v_lot.vendor_text);\n        v_remaining := v_remaining - v_take;\n      end loop;\n      if v_remaining > 0 then\n        -- what was used: no longer costed by this purchase, short until a purchase covers it\n        for v_draw in select d.id, d.txn_id, d.quantity, d.unit_cost from public.inventory_lot_draws d\n          join public.inventory_lots l on l.id = d.lot_id\n          join public.inventory_transactions t on t.id = d.txn_id\n          where l.source_txn_id = p_txn.reference_id and t.txn_type = ''consumption'' and t.reversed_by is null loop\n          update public.inventory_transactions\n            set total_cost = total_cost + round(v_draw.quantity * v_draw.unit_cost, 2)\n            where id = v_draw.txn_id;\n          update public.inventory_transactions\n            set unit_cost = round(abs(total_cost) / nullif(abs(quantity), 0), 4)\n            where id = v_draw.txn_id;\n          update public.inventory_lot_draws set vendor_bill_id = null, vendor_text = ''No purchase on record'', unit_cost = 0 where id = v_draw.id;\n        end loop;\n        insert into public.inventory_lots (item_id, location_id, vendor_text, unit_cost, remaining, source_txn_id)\n          values (p_txn.item_id, p_txn.location_id, ''No purchase on record'', 0, -v_remaining, p_txn.id)\n          returning id into v_new_lot;\n        insert into public.inventory_lot_draws (txn_id, lot_id, quantity, unit_cost, vendor_text)\n          values (p_txn.id, v_new_lot, v_remaining, 0, ''No purchase on record'');\n      end if;\n      return;\n    end if;\n    v_remaining := -p_txn.quantity;');
  if d2 = d then raise exception 'marker not found in apply_lot_movement'; end if;
  execute d2;
end $$;
