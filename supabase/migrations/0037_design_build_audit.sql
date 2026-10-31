-- Audit trail (same generic audit_row_change() trigger used everywhere else, 0011) on every
-- financially-relevant new table: every correction, approval, match, and status change stays
-- traceable, as the spec requires throughout.

create trigger trg_audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_row_change();
create trigger trg_audit_design_projects after insert or update or delete on public.design_projects
  for each row execute function public.audit_row_change();
create trigger trg_audit_inventory_items after insert or update or delete on public.inventory_items
  for each row execute function public.audit_row_change();
create trigger trg_audit_inventory_transactions after insert or update or delete on public.inventory_transactions
  for each row execute function public.audit_row_change();
create trigger trg_audit_supplier_bills after insert or update or delete on public.supplier_bills
  for each row execute function public.audit_row_change();
create trigger trg_audit_supplier_bill_items after insert or update or delete on public.supplier_bill_items
  for each row execute function public.audit_row_change();
create trigger trg_audit_supplier_bill_payments after insert or update or delete on public.supplier_bill_payments
  for each row execute function public.audit_row_change();
create trigger trg_audit_bank_transactions after insert or update or delete on public.bank_transactions
  for each row execute function public.audit_row_change();
create trigger trg_audit_gst_invoice_followups after insert or update or delete on public.gst_invoice_followups
  for each row execute function public.audit_row_change();
create trigger trg_audit_itc_status after insert or update or delete on public.itc_status
  for each row execute function public.audit_row_change();
create trigger trg_audit_material_match_suggestions after insert or update or delete on public.material_match_suggestions
  for each row execute function public.audit_row_change();
