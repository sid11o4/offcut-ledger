-- "Internal Order" is now "Design Build Order" in everything a person reads: the Design Build
-- ledger category and the descriptions written when a job's material is consumed. The stored
-- reference type 'internal_order' is unchanged, because reversals match on it.

create or replace function public.design_build_ledger(p_start date, p_end date)
returns table(txn_date date, category text, description text, reference text, amount numeric, reference_type text, reference_id uuid, design_project_id uuid, project_name text)
language sql
stable
set search_path = 'public'
as $function$
  select coalesce(pay.confirmed_at::date, pay.created_at::date), 'Supplier Payment',
    coalesce(s.name, sb.supplier_text, 'Supplier') || ' — ' || sb.internal_bill_number,
    sb.internal_bill_number, pay.allocated_amount, 'supplier_bill_payment', pay.id,
    sb.design_project_id, dp.name
  from public.supplier_bill_payments pay
  join public.supplier_bills sb on sb.id = pay.bill_id
  left join public.suppliers s on s.id = sb.supplier_id
  left join public.design_projects dp on dp.id = sb.design_project_id
  where sb.status = 'approved'
    and pay.mode in ('cash', 'rtgs_neft') and (pay.mode = 'cash' or pay.confirmed)
    and coalesce(pay.confirmed_at::date, pay.created_at::date) between p_start and p_end
  union all
  select e.entry_date, 'Design Build Order',
    'Design Build Order job-work — ' || p.name,
    p.code, e.total_amount, 'job_work_entry', e.id, dp.id, dp.name
  from public.job_work_entries e
  join public.design_projects dp on dp.factory_project_id = e.project_id
  join public.projects p on p.id = e.project_id
  where e.billed and e.status = 'active' and e.entry_date between p_start and p_end
  union all
  select x.expense_date, 'Direct Expense',
    coalesce(c.name, 'Expense') || coalesce(' — ' || x.description, ''),
    x.payment_reference, x.amount, 'design_build_expense', x.id, x.design_project_id, dp.name
  from public.design_build_expenses x
  left join public.expense_categories c on c.id = x.category_id
  left join public.design_projects dp on dp.id = x.design_project_id
  where x.status = 'active' and x.expense_date between p_start and p_end
  order by 1 desc;
$function$;

create or replace function public.bill_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_billed boolean;
  v_status text;
  v_entry record;
  v_design_project_id uuid;
begin
  select billed, status into v_billed, v_status
  from public.job_work_entries
  where id = new.job_work_entry_id
  for update;

  if v_status is null then
    raise exception 'Job-work entry % does not exist.', new.job_work_entry_id;
  end if;
  if v_status <> 'active' then
    raise exception 'Cannot bill a cancelled job-work entry.';
  end if;
  if v_billed then
    raise exception 'Job-work entry % is already billed.', new.job_work_entry_id;
  end if;

  update public.job_work_entries
    set billed = true, bill_item_id = new.id
    where id = new.job_work_entry_id;

  select e.*, dp.id as linked_design_project_id into v_entry
  from public.job_work_entries e
  left join public.design_projects dp on dp.factory_project_id = e.project_id
  where e.id = new.job_work_entry_id;

  v_design_project_id := v_entry.linked_design_project_id;

  if v_design_project_id is not null then
    if v_entry.raw_material_item_id is not null and coalesce(v_entry.raw_material_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.raw_material_item_id, v_design_project_id, v_entry.raw_material_qty, v_entry.entry_date,
        'internal_order', new.id, 'Raw material for Design Build Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin1_item_id is not null and coalesce(v_entry.skin1_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin1_item_id, v_design_project_id, v_entry.skin1_qty, v_entry.entry_date,
        'internal_order', new.id, 'Skin 1 (lamination) for Design Build Order job-work, billed ' || new.id);
    end if;
    if v_entry.skin2_item_id is not null and coalesce(v_entry.skin2_qty, 0) > 0 then
      perform public.record_inventory_consumption(
        v_entry.skin2_item_id, v_design_project_id, v_entry.skin2_qty, v_entry.entry_date,
        'internal_order', new.id, 'Skin 2 (double-side lamination) for Design Build Order job-work, billed ' || new.id);
    end if;
  end if;

  return new;
end;
$function$;
