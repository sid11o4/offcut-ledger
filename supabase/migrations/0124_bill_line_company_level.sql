-- A bill or line can be charged to the Design Build company itself (no project): stock goes to Company
-- inventory, and lines consumed directly count as non-project consumption.
alter table public.supplier_bill_items add column if not exists company_level boolean not null default false;

do $$
declare d text; blk text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'approve_supplier_bill' and pronamespace = 'public'::regnamespace;
  blk := E'if exists (select 1 from public.supplier_bill_items where bill_id = p_bill_id and consumed_directly and coalesce(design_project_id, v_bill.design_project_id) is null) then\n      raise exception ''Lines consumed directly need a project. Choose the project for those lines or for the bill.'';\n    end if;\n    ';
  if position(blk in d) = 0 then raise exception 'approve block missing'; end if;
  d := replace(d, blk, '');
  if position('coalesce(v_item.design_project_id, v_bill.design_project_id)' in d) = 0 then raise exception 'approve marker missing'; end if;
  d := replace(d, 'coalesce(v_item.design_project_id, v_bill.design_project_id)', 'case when v_item.company_level then null else coalesce(v_item.design_project_id, v_bill.design_project_id) end');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'post_unlinked_bill_lines' and pronamespace = 'public'::regnamespace;
  if position('coalesce(v_line.design_project_id, v_bill.design_project_id)' in d) = 0 then raise exception 'post marker missing'; end if;
  d := replace(d, 'coalesce(v_line.design_project_id, v_bill.design_project_id)', 'case when v_line.company_level then null else coalesce(v_line.design_project_id, v_bill.design_project_id) end');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where proname = 'design_build_cost_breakdown' and pronamespace = 'public'::regnamespace;
  if position('coalesce(i.design_project_id, b.design_project_id) as dp' in d) = 0 then raise exception 'breakdown marker missing'; end if;
  d := replace(d, 'coalesce(i.design_project_id, b.design_project_id) as dp', 'case when i.company_level then null else coalesce(i.design_project_id, b.design_project_id) end as dp');
  execute d;
end $$;
