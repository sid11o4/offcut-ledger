-- Trigger-only functions never need a direct grant -- Postgres trigger firing doesn't require
-- the invoking session to hold EXECUTE on the trigger function itself. Supabase's own bootstrap
-- grants EXECUTE on every new function to anon/authenticated regardless, so each still needs an
-- explicit revoke (same issue 0017 and 0038 already fixed for the RPC surface).
revoke execute on function
  public.design_projects_create_location(),
  public.inventory_items_set_tracking(),
  public.supplier_bill_items_calc(),
  public.supplier_bill_items_changed(),
  public.supplier_bill_payments_cash_confirm(),
  public.supplier_bill_payments_check_followup(),
  public.bank_transactions_set_dedupe_key()
from public, anon, authenticated;
