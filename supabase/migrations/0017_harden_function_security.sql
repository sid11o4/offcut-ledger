-- Security hardening flagged by the Supabase advisor (spec section 56/57):
--   1. Pin search_path on every function that didn't already set one, so none of them can be
--      hijacked via a malicious search_path.
--   2. Trigger-only functions have no business being directly callable as a PostgREST RPC.
--      Postgres grants EXECUTE to PUBLIC by default, which is what the advisor flagged. Revoke
--      that (for existing and future functions) and re-grant EXECUTE only to `authenticated`,
--      and only on the functions the app actually calls as RPCs. Trigger firing is unaffected
--      -- it doesn't require the invoking session to hold EXECUTE on the trigger function.

alter function public.set_updated_at() set search_path = public;
alter function public.prevent_nested_composite_component() set search_path = public;
alter function public.compute_service_components(uuid, numeric) set search_path = public;
alter function public.cancel_job_work_entry(uuid, text) set search_path = public;
alter function public.generate_bill(uuid, uuid[], date, date, numeric, numeric, text, text) set search_path = public;
alter function public.cancel_bill(uuid, text) set search_path = public;
alter function public.void_expense(uuid, text) set search_path = public;
alter function public.next_estimate_number() set search_path = public;
alter function public.recalc_estimate_totals(uuid) set search_path = public;
alter function public.next_bill_number() set search_path = public;
alter function public.check_project_not_cancelled() set search_path = public;
alter function public.get_effective_rate(uuid, uuid, date) set search_path = public;
alter function public.report_revenue_by_project(date, date) set search_path = public;
alter function public.report_revenue_by_service(date, date) set search_path = public;
alter function public.report_revenue_by_process(date, date) set search_path = public;
alter function public.report_revenue_by_machine(date, date) set search_path = public;
alter function public.report_revenue_by_rate_category(date, date) set search_path = public;
alter function public.report_revenue_by_date(date, date) set search_path = public;
alter function public.report_billing_status(date, date) set search_path = public;
alter function public.project_financials(uuid) set search_path = public;
alter function public.income_expense_statement(date, date) set search_path = public;
alter function public.expense_breakdown_by_category(date, date) set search_path = public;
alter function public.prevent_self_role_escalation() set search_path = public;

-- Note: "... FROM PUBLIC" only strips the PUBLIC pseudo-role's own ACL entry. Supabase's own
-- project bootstrap additionally grants EXECUTE on every new function directly to anon and
-- authenticated (visible in pg_default_acl for role postgres, which is what applies migrations
-- run under) -- a separate grant that a FROM PUBLIC revoke does not touch, so both are revoked
-- explicitly here.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

grant execute on function
  public.has_permission(text),
  public.current_role_key(),
  public.is_active_user(),
  public.get_effective_rate(uuid, uuid, date),
  public.ensure_daily_log(date),
  public.sync_recurring_expenses(date),
  public.compute_service_components(uuid, numeric),
  public.record_job_work_entry(date, uuid, uuid, numeric, text, jsonb),
  public.cancel_job_work_entry(uuid, text),
  public.generate_bill(uuid, uuid[], date, date, numeric, numeric, text, text),
  public.cancel_bill(uuid, text),
  public.void_expense(uuid, text),
  public.next_estimate_number(),
  public.next_bill_number(),
  public.report_revenue_by_project(date, date),
  public.report_revenue_by_service(date, date),
  public.report_revenue_by_process(date, date),
  public.report_revenue_by_machine(date, date),
  public.report_revenue_by_rate_category(date, date),
  public.report_revenue_by_date(date, date),
  public.report_billing_status(date, date),
  public.project_financials(uuid),
  public.income_expense_statement(date, date),
  public.expense_breakdown_by_category(date, date)
to authenticated;
