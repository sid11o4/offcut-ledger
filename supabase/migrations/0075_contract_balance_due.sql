-- The contract summary's balance_due was a placeholder of 0. It is now contract minus the
-- collections received (voided receipts excluded).
create or replace function public.project_contract_summary(p_design_project_id uuid)
returns table(contract_total numeric, received_total numeric, balance_due numeric, scope_count integer, quotation_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select
      case when (select count(*) from public.project_scope_items s where s.design_project_id = p_design_project_id) > 0
        then (select coalesce(sum(s.amount), 0) from public.project_scope_items s where s.design_project_id = p_design_project_id)
        else coalesce((select q.quoted_total from public.project_quotations q where q.design_project_id = p_design_project_id order by q.created_at desc limit 1), 0)
      end as contract,
      coalesce((select sum(c.amount) from public.project_collections c where c.design_project_id = p_design_project_id and not c.voided), 0) as received
  )
  select
    t.contract,
    t.received,
    t.contract - t.received,
    (select count(*)::int from public.project_scope_items s where s.design_project_id = p_design_project_id),
    (select count(*)::int from public.project_quotations q where q.design_project_id = p_design_project_id)
  from totals t
$$;
