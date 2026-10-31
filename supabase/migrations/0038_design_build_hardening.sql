-- Security hardening for everything added in 0027-0037, flagged by the Supabase advisor --
-- same three issues 0017 already fixed once for the original app, recurring because these
-- migrations ran under a different role than 0017's "alter default privileges for role
-- postgres" covered:
--   1. Five trigger functions didn't pin search_path.
--   2. pg_trgm installed into public instead of a dedicated schema.
--   3. anon/authenticated had broader EXECUTE than intended on the new functions.

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

alter function public.inventory_items_set_tracking() set search_path = public;
alter function public.next_inventory_slip_number() set search_path = public;
alter function public.supplier_bill_items_calc() set search_path = public;
alter function public.supplier_bill_payments_cash_confirm() set search_path = public;
alter function public.bank_transactions_set_dedupe_key() set search_path = public;

-- Revoke broad EXECUTE from everything this set of migrations created, then re-grant only the
-- genuine RPC surface to `authenticated` -- trigger-only functions (design_projects_create_location,
-- supplier_bill_items_calc, supplier_bill_items_changed, supplier_bill_payments_cash_confirm,
-- supplier_bill_payments_check_followup, bank_transactions_set_dedupe_key,
-- inventory_items_set_tracking) are deliberately left with no direct grant: Postgres trigger
-- firing never requires the invoking session to hold EXECUTE on the trigger function itself.
revoke execute on function
  public.record_inventory_transaction(text, uuid, uuid, numeric, numeric, date, text, uuid, text),
  public.record_inventory_purchase(uuid, uuid, numeric, numeric, date, text, uuid, text),
  public.record_inventory_transfer(uuid, uuid, uuid, numeric, date, text),
  public.record_inventory_consumption(uuid, uuid, numeric, date, text, uuid, text),
  public.post_inventory_slip(uuid),
  public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb, uuid, uuid, numeric, uuid, numeric, uuid, numeric),
  public.recalc_supplier_bill_totals(uuid),
  public.approve_supplier_bill(uuid),
  public.suggest_bank_matches(uuid),
  public.confirm_bank_match(uuid, uuid),
  public.ensure_gst_followup(uuid),
  public.record_gst_invoice_received(uuid, text, date, text),
  public.report_itc_180day_risk(),
  public.confirm_material_match(uuid),
  public.reject_material_match(uuid),
  public.report_design_project_financials(uuid),
  public.report_design_projects_summary(),
  public.report_company_inventory_value()
from public, anon, authenticated;

grant execute on function
  public.record_inventory_transaction(text, uuid, uuid, numeric, numeric, date, text, uuid, text),
  public.record_inventory_purchase(uuid, uuid, numeric, numeric, date, text, uuid, text),
  public.record_inventory_transfer(uuid, uuid, uuid, numeric, date, text),
  public.record_inventory_consumption(uuid, uuid, numeric, date, text, uuid, text),
  public.post_inventory_slip(uuid),
  public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb, uuid, uuid, numeric, uuid, numeric, uuid, numeric),
  public.recalc_supplier_bill_totals(uuid),
  public.approve_supplier_bill(uuid),
  public.suggest_bank_matches(uuid),
  public.confirm_bank_match(uuid, uuid),
  public.ensure_gst_followup(uuid),
  public.record_gst_invoice_received(uuid, text, date, text),
  public.report_itc_180day_risk(),
  public.confirm_material_match(uuid),
  public.reject_material_match(uuid),
  public.report_design_project_financials(uuid),
  public.report_design_projects_summary(),
  public.report_company_inventory_value()
to authenticated;
