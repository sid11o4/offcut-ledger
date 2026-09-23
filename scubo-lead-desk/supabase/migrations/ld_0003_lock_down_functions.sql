-- Postgres grants EXECUTE on new functions to PUBLIC. Nothing in the lead desk is meant
-- for signed-out callers, so revoke that and grant back only what the app calls.
revoke execute on all functions in schema leaddesk from public, anon;
grant execute on function leaddesk.is_member(), leaddesk.is_admin(), leaddesk.needs_setup(),
  leaddesk.claim_first_admin(), leaddesk.import_leads(jsonb) to authenticated;
alter default privileges in schema leaddesk revoke execute on functions from public;
