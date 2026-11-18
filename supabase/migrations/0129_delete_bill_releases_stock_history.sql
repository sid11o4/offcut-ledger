-- Deleting a bill that was approved and then reopened or voided failed with a foreign key error, because the stock lots and
-- draws that came from it still pointed at the bill. They now keep the vendor's name and are released before the bill goes.
-- A bill that a return credit was adjusted against still cannot be deleted.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'delete_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('delete from public.supplier_bills where id = p_bill_id;' in d) = 0 then raise exception 'delete marker missing'; end if;
  d := replace(d, 'delete from public.supplier_bills where id = p_bill_id;',
    E'if exists (select 1 from public.supplier_return_slips where adjusted_bill_id = p_bill_id) then\n    raise exception ''A return credit was adjusted against this bill, so it cannot be deleted.'';\n  end if;\n  -- Stock history that came from this bill keeps its vendor name but no longer points at the bill.\n  update public.inventory_lots set vendor_text = coalesce(nullif(vendor_text, ''''), (select coalesce(s.name, b.supplier_text, ''Deleted bill'') from public.supplier_bills b left join public.suppliers s on s.id = b.supplier_id where b.id = p_bill_id)), vendor_bill_id = null where vendor_bill_id = p_bill_id;\n  update public.inventory_lot_draws set vendor_text = coalesce(nullif(vendor_text, ''''), (select coalesce(s.name, b.supplier_text, ''Deleted bill'') from public.supplier_bills b left join public.suppliers s on s.id = b.supplier_id where b.id = p_bill_id)), vendor_bill_id = null where vendor_bill_id = p_bill_id;\n  delete from public.supplier_bills where id = p_bill_id;');
  execute d;
end $$;
