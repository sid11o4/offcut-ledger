-- A return from a bill takes stock out at the location each bill line was posted to (its own project, the company, or the
-- bill's project), not at the first place the item was ever bought, so a bill split across projects returns from the right places.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = '_add_return_lines' and pronamespace = 'public'::regnamespace;
  if position('select location_id into v_loc from public.inventory_transactions' in d) = 0 then raise exception 'marker 1 missing'; end if;
  d := replace(d,
    E'select location_id into v_loc from public.inventory_transactions\n          where reference_type = ''supplier_bill'' and reference_id = v_slip.bill_id and item_id = v_bi.inventory_item_id and txn_type = ''purchase''\n          order by created_at limit 1;',
    E'-- the location this bill line was posted to: its own project (or the company), else the bill''s project\n        v_loc := public.bill_location_for(case when v_bi.company_level then null else coalesce(v_bi.design_project_id, (select design_project_id from public.supplier_bills where id = v_slip.bill_id)) end);');
  if position('v_loc := public.bill_location_for' in d) = 0 then raise exception 'replace did not apply'; end if;
  execute d;
end $$;
