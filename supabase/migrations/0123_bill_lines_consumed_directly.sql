-- A vendor bill line can be consumed directly: charged to its project as a cost, never added to stock.
alter table public.supplier_bill_items add column if not exists consumed_directly boolean not null default false;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'approve_supplier_bill' and pronamespace = 'public'::regnamespace;
  if position('item_type = ''material'' and inventory_item_id is not null' in d) = 0 then raise exception 'approve marker 1 missing'; end if;
  if position('perform public.post_unlinked_bill_lines(p_bill_id);' in d) = 0 then raise exception 'approve marker 2 missing'; end if;
  d := replace(d, 'item_type = ''material'' and inventory_item_id is not null', 'item_type = ''material'' and inventory_item_id is not null and not consumed_directly');
  d := replace(d, 'perform public.post_unlinked_bill_lines(p_bill_id);',
    E'if exists (select 1 from public.supplier_bill_items where bill_id = p_bill_id and consumed_directly and coalesce(design_project_id, v_bill.design_project_id) is null) then\n      raise exception ''Lines consumed directly need a project. Choose the project for those lines or for the bill.'';\n    end if;\n    perform public.post_unlinked_bill_lines(p_bill_id);');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'post_unlinked_bill_lines' and pronamespace = 'public'::regnamespace;
  if position('not in (''transport'', ''miscellaneous'')' in d) = 0 then raise exception 'post marker missing'; end if;
  d := replace(d, 'not in (''transport'', ''miscellaneous'')', 'not in (''transport'', ''miscellaneous'') and not consumed_directly');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'design_build_cost_breakdown' and pronamespace = 'public'::regnamespace;
  if position('and i.inventory_item_id is null and not i.pays_vendor_credit' in d) = 0 then raise exception 'breakdown marker missing'; end if;
  d := replace(d, 'and i.inventory_item_id is null and not i.pays_vendor_credit', 'and (i.inventory_item_id is null or i.consumed_directly) and not i.pays_vendor_credit');
  execute d;
end $$;
