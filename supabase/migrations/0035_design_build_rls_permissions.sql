-- RLS + permission keys for every Design Build / Accounts table added in 0027-0034. Same
-- convention as the rest of the app (0014): read gated by is_active_user(), writes gated by
-- has_permission(). Reuses the existing private 'scan-uploads' storage bucket (0026) for
-- supplier-bill photos and official GST invoice images rather than creating a new bucket --
-- its policies are already is_active_user()-gated and generic (keyed by path, not table).

insert into public.permissions (key, label, description) values
  ('design_build_manage', 'Design Build: manage', 'Create/edit Design Build projects, inventory items, and suppliers (master data).'),
  ('inventory_operate', 'Inventory: operate', 'Record purchases, transfers, consumption, and manual slips.'),
  ('supplier_bills_manage', 'Supplier bills: manage', 'Create, audit, and approve supplier bills and payments.'),
  ('bank_reconciliation', 'Bank reconciliation', 'Import bank statements and confirm payment matches.'),
  ('gst_compliance', 'GST compliance', 'Manage GST invoice follow-up and ITC review.')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, case
  when r.key = 'admin' then true
  when r.key = 'manager' and p.key in ('design_build_manage', 'inventory_operate', 'supplier_bills_manage') then true
  when r.key = 'staff' and p.key = 'inventory_operate' then true
  when r.key = 'accounts' and p.key in ('inventory_operate', 'supplier_bills_manage', 'bank_reconciliation', 'gst_compliance') then true
  else false
end
from public.roles r
cross join public.permissions p
where p.key in ('design_build_manage', 'inventory_operate', 'supplier_bills_manage', 'bank_reconciliation', 'gst_compliance')
on conflict (role_id, permission_key) do nothing;

alter table public.suppliers enable row level security;
alter table public.design_projects enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.inventory_slips enable row level security;
alter table public.inventory_slip_items enable row level security;
alter table public.supplier_bills enable row level security;
alter table public.supplier_bill_items enable row level security;
alter table public.supplier_bill_payments enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.gst_invoice_followups enable row level security;
alter table public.itc_status enable row level security;
alter table public.material_match_suggestions enable row level security;

create policy suppliers_select on public.suppliers for select using (public.is_active_user());
create policy suppliers_insert on public.suppliers for insert with check (public.has_permission('design_build_manage') or public.has_permission('supplier_bills_manage'));
create policy suppliers_update on public.suppliers for update using (public.has_permission('design_build_manage') or public.has_permission('supplier_bills_manage'));

create policy design_projects_select on public.design_projects for select using (public.is_active_user());
create policy design_projects_insert on public.design_projects for insert with check (public.has_permission('design_build_manage'));
create policy design_projects_update on public.design_projects for update using (public.has_permission('design_build_manage'));

create policy inventory_items_select on public.inventory_items for select using (public.is_active_user());
create policy inventory_items_insert on public.inventory_items for insert with check (public.has_permission('design_build_manage') or public.has_permission('supplier_bills_manage'));
create policy inventory_items_update on public.inventory_items for update using (public.has_permission('design_build_manage') or public.has_permission('supplier_bills_manage'));

create policy inventory_locations_select on public.inventory_locations for select using (public.is_active_user());
-- No direct insert/update policy: locations are only created by design_projects_create_location()
-- (SECURITY DEFINER, bypasses RLS as the owning role) plus the one seeded company row.

create policy inventory_stock_select on public.inventory_stock for select using (public.is_active_user());
-- No direct write policy at all: inventory_stock is only ever written by
-- record_inventory_transaction() (SECURITY DEFINER), never by the client directly -- same
-- "no direct inserts" pattern as job_work_entries (0020).

create policy inventory_transactions_select on public.inventory_transactions for select using (public.is_active_user());
-- No direct write policy: only record_inventory_transaction() (SECURITY DEFINER) writes here.

create policy inventory_slips_select on public.inventory_slips for select using (public.is_active_user());
create policy inventory_slips_insert on public.inventory_slips for insert with check (public.has_permission('inventory_operate') and created_by = (select auth.uid()));

create policy inventory_slip_items_select on public.inventory_slip_items for select using (public.is_active_user());
create policy inventory_slip_items_insert on public.inventory_slip_items for insert with check (public.has_permission('inventory_operate'));
-- inventory_txn_id / transfer_group_id are filled in by post_inventory_slip() (SECURITY
-- DEFINER) after the fact, so an update policy is needed for that -- but only that function
-- should ever change them in practice; RLS still requires the caller hold the same permission.
create policy inventory_slip_items_update on public.inventory_slip_items for update using (public.has_permission('inventory_operate'));

create policy supplier_bills_select on public.supplier_bills for select
  using (public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));
create policy supplier_bills_insert on public.supplier_bills for insert with check (public.has_permission('supplier_bills_manage'));
create policy supplier_bills_update on public.supplier_bills for update using (public.has_permission('supplier_bills_manage'));

create policy supplier_bill_items_select on public.supplier_bill_items for select
  using (public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));
create policy supplier_bill_items_insert on public.supplier_bill_items for insert with check (public.has_permission('supplier_bills_manage'));
create policy supplier_bill_items_update on public.supplier_bill_items for update using (public.has_permission('supplier_bills_manage'));
create policy supplier_bill_items_delete on public.supplier_bill_items for delete using (public.has_permission('supplier_bills_manage'));

create policy supplier_bill_payments_select on public.supplier_bill_payments for select
  using (public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));
create policy supplier_bill_payments_insert on public.supplier_bill_payments for insert with check (public.has_permission('supplier_bills_manage'));

create policy bank_statement_imports_select on public.bank_statement_imports for select using (public.has_permission('bank_reconciliation') or public.has_permission('financial_reports'));
create policy bank_statement_imports_insert on public.bank_statement_imports for insert with check (public.has_permission('bank_reconciliation'));

create policy bank_transactions_select on public.bank_transactions for select using (public.has_permission('bank_reconciliation') or public.has_permission('financial_reports'));
create policy bank_transactions_insert on public.bank_transactions for insert with check (public.has_permission('bank_reconciliation'));
-- matched/matched_payment_id are set by confirm_bank_match() (SECURITY DEFINER); no update
-- policy needed for the client.

create policy gst_invoice_followups_select on public.gst_invoice_followups for select using (public.has_permission('gst_compliance') or public.has_permission('financial_reports'));
create policy gst_invoice_followups_update on public.gst_invoice_followups for update using (public.has_permission('gst_compliance'));

create policy itc_status_select on public.itc_status for select using (public.has_permission('gst_compliance') or public.has_permission('financial_reports'));
create policy itc_status_update on public.itc_status for update using (public.has_permission('gst_compliance'));

create policy material_match_suggestions_select on public.material_match_suggestions for select using (public.has_permission('supplier_bills_manage'));
create policy material_match_suggestions_update on public.material_match_suggestions for update using (public.has_permission('supplier_bills_manage'));
-- Inserted only by the extract-supplier-bill-scan Edge Function (service role, bypasses RLS).
