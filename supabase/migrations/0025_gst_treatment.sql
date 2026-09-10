-- GST on bills: CGST/SGST split (display-side, always half+half) and a per-bill GST-waiver
-- option -- full statutory GST, a 50% waiver, or a full waiver -- requested by the factory
-- owner for concessional / exempt jobs.
--
-- Storage: bills.tax_percent stays the NOMINAL statutory rate that was entered (e.g. 18).
-- bills.gst_treatment records the waiver. bills.tax_amount is the actual GST charged after
-- the waiver multiplier, and grand_total reconciles as subtotal + tax_amount + adjustments.
-- The CGST/SGST 50/50 split is derived at display time (src/lib/gst.js), not stored.

alter table public.bills
  add column gst_treatment text not null default 'full'
  check (gst_treatment in ('full', 'half_waiver', 'full_waiver'));

drop function if exists public.generate_bill(uuid, uuid[], date, date, numeric, numeric, text, text);
create function public.generate_bill(
  p_project_id uuid,
  p_entry_ids uuid[],
  p_billing_period_start date default null,
  p_billing_period_end date default null,
  p_tax_percent numeric default 0,
  p_adjustments numeric default 0,
  p_adjustment_notes text default null,
  p_notes text default null,
  p_gst_treatment text default 'full'
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_client_id uuid;
  v_bill_id uuid;
  v_subtotal numeric := 0;
  v_multiplier numeric;
  v_tax numeric;
  v_bad_count int;
begin
  if not public.has_permission('billing') then
    raise exception 'You do not have permission to generate bills.';
  end if;
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    raise exception 'Select at least one job-work entry to bill.';
  end if;
  if coalesce(p_gst_treatment, 'full') not in ('full', 'half_waiver', 'full_waiver') then
    raise exception 'Invalid GST treatment.';
  end if;

  select count(*) into v_bad_count
  from public.job_work_entries
  where id = any(p_entry_ids)
    and (project_id <> p_project_id or status <> 'active' or billed);
  if v_bad_count > 0 then
    raise exception 'One or more selected entries are not eligible for billing (wrong project, cancelled, or already billed).';
  end if;

  select client_id into v_client_id from public.projects where id = p_project_id;

  select coalesce(sum(total_amount), 0) into v_subtotal
  from public.job_work_entries where id = any(p_entry_ids);

  v_multiplier := case coalesce(p_gst_treatment, 'full')
    when 'full_waiver' then 0
    when 'half_waiver' then 0.5
    else 1
  end;
  v_tax := round(v_subtotal * coalesce(p_tax_percent, 0) / 100 * v_multiplier, 2);

  insert into public.bills
    (client_id, project_id, billing_period_start, billing_period_end, status,
     subtotal, tax_percent, tax_amount, gst_treatment, adjustments, adjustment_notes, grand_total, notes, created_by)
  values
    (v_client_id, p_project_id, p_billing_period_start, p_billing_period_end, 'issued',
     v_subtotal, coalesce(p_tax_percent, 0), v_tax, coalesce(p_gst_treatment, 'full'),
     coalesce(p_adjustments, 0), p_adjustment_notes,
     v_subtotal + v_tax + coalesce(p_adjustments, 0), p_notes, auth.uid())
  returning id into v_bill_id;

  insert into public.bill_items (bill_id, job_work_entry_id, service_id, entry_date, quantity, unit_id, amount)
  select v_bill_id, e.id, e.service_id, e.entry_date, e.base_quantity, e.unit_id, e.total_amount
  from public.job_work_entries e
  where e.id = any(p_entry_ids);

  return v_bill_id;
end;
$$;

grant execute on function
  public.generate_bill(uuid, uuid[], date, date, numeric, numeric, text, text, text)
to authenticated;
