-- Initial configuration data (spec section 58). Everything here is editable/deactivatable
-- afterwards from Masters/Settings -- nothing here is hard-coded into application logic.

insert into public.roles (key, name, description) values
  ('admin', 'Admin', 'Full access to all modules, masters, and permissions.'),
  ('manager', 'Manager', 'Views all data; manages projects, estimates, billing, expenses, and approvals.'),
  ('staff', 'Factory Staff', 'Logs daily job-work and daily expenses. No rate or billing access.'),
  ('accounts', 'Accounts', 'Manages billing, expenses, and financial reports.');

insert into public.permissions (key, label, description) values
  ('master_data', 'Manage masters', 'Create/edit machines, processes, units, job-work services & combinations, rate categories, expense categories.'),
  ('project_manage', 'Manage clients & projects', 'Create/edit clients and projects.'),
  ('rate_management', 'Manage rates', 'Add new effective-dated rates.'),
  ('rate_override', 'Override rates', 'Override the auto-selected rate on a job-work entry.'),
  ('billing', 'Generate & view bills', 'Select unbilled work and generate project bills; view bills.'),
  ('bill_cancel', 'Cancel bills', 'Cancel an issued bill, releasing its entries back to unbilled.'),
  ('estimates', 'Manage estimates', 'Create and edit job-work estimates.'),
  ('expense_manage', 'Manage expenses', 'Create/edit recurring expenses; void a manual expense.'),
  ('historical_edit', 'Edit historical entries', 'Edit or cancel job-work entries and expenses after creation.'),
  ('financial_reports', 'View financial reports', 'View the income/expense statement and factory-wide financial reports.'),
  ('user_manage', 'Manage users & roles', 'Assign roles to users and edit role permissions.');

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, true from public.roles r cross join public.permissions p where r.key = 'admin';

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key,
  p.key in ('project_manage','rate_override','billing','bill_cancel','estimates','expense_manage','historical_edit','financial_reports')
from public.roles r cross join public.permissions p where r.key = 'manager';

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, false
from public.roles r cross join public.permissions p where r.key = 'staff';

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key,
  p.key in ('project_manage','billing','bill_cancel','estimates','expense_manage','historical_edit','financial_reports')
from public.roles r cross join public.permissions p where r.key = 'accounts';

insert into public.units (code, name, description) values
  ('SQFT', 'Sq.ft', 'Square feet'),
  ('RFT', 'R.ft', 'Running feet'),
  ('NOS', 'Nos', 'Numbers / pieces'),
  ('SHEET', 'Sheets', 'Sheets');

insert into public.machines (code, name, description) values
  ('PANEL_SAW', 'Panel Saw', 'Panel cutting saw'),
  ('COLD_PRESS', 'Cold Press', 'Cold press pasting machine'),
  ('EDGEBAND', 'Edgebanding Machine', 'Edge banding machine');

insert into public.processes (code, name, machine_id, default_unit_id)
select 'CUTTING', 'Cutting', m.id, u.id from public.machines m, public.units u where m.code = 'PANEL_SAW' and u.code = 'SQFT';
insert into public.processes (code, name, machine_id, default_unit_id)
select 'PASTING', 'Pasting', m.id, u.id from public.machines m, public.units u where m.code = 'COLD_PRESS' and u.code = 'SQFT';
insert into public.processes (code, name, machine_id, default_unit_id)
select 'EDGEBANDING', 'Edgebanding', m.id, u.id from public.machines m, public.units u where m.code = 'EDGEBAND' and u.code = 'RFT';

insert into public.rate_categories (code, name, description) values
  ('INTERNAL', 'Internal Order', 'Work for the factory''s own stock/use.'),
  ('REGULAR', 'Regular Client', 'Repeat client with an ongoing arrangement.'),
  ('ONEOFF', 'One-Off Client', 'Single/occasional order.');

insert into public.expense_categories (code, name) values
  ('LABOUR', 'Labour'),
  ('CONSUMABLES', 'Consumables'),
  ('TRANSPORT', 'Transport'),
  ('ELECTRICITY', 'Electricity'),
  ('MAINTENANCE', 'Maintenance'),
  ('REPAIRS', 'Repairs'),
  ('PACKING', 'Packing'),
  ('MISC', 'Miscellaneous');

-- Atomic (rate-bearing) job-work services -- each maps 1:1 to a process/machine.
-- Documented assumption resolving an inconsistency between spec sections 6/9/42: the worked
-- calculation example in section 42 ("Double Side Cutting = 1x Cutting + 2x Pasting, using the
-- Cutting Rate and the Pasting Rate") is treated as authoritative, so Cutting and Pasting
-- (not "Single/Double Pasting") are the atomic rate-bearing services. "Single Pasting" and
-- "Single Side Cutting" are then 1x composites over them, kept as named services because
-- that's how staff/clients refer to the job -- not because they price any differently.
insert into public.job_work_services (code, name, unit_id, process_id, is_composite)
select 'CUTTING', 'Cutting', u.id, p.id, false
from public.units u, public.processes p where u.code = 'SQFT' and p.code = 'CUTTING';

insert into public.job_work_services (code, name, unit_id, process_id, is_composite)
select 'PASTING', 'Pasting', u.id, p.id, false
from public.units u, public.processes p where u.code = 'SQFT' and p.code = 'PASTING';

insert into public.job_work_services (code, name, unit_id, process_id, is_composite)
select 'EDGE_08', 'Edgebanding 0.8 mm', u.id, p.id, false
from public.units u, public.processes p where u.code = 'RFT' and p.code = 'EDGEBANDING';

insert into public.job_work_services (code, name, unit_id, process_id, is_composite)
select 'EDGE_13', 'Edgebanding 1.3 mm and above', u.id, p.id, false
from public.units u, public.processes p where u.code = 'RFT' and p.code = 'EDGEBANDING';

-- Composite (billable) job-work services -- what staff actually pick in the Daily Log.
insert into public.job_work_services (code, name, unit_id, is_composite)
select 'SS_CUT', 'Single Side Cutting', u.id, true from public.units u where u.code = 'SQFT';
insert into public.job_work_services (code, name, unit_id, is_composite)
select 'DS_CUT', 'Double Side Cutting', u.id, true from public.units u where u.code = 'SQFT';
insert into public.job_work_services (code, name, unit_id, is_composite)
select 'SINGLE_PASTE', 'Single Pasting', u.id, true from public.units u where u.code = 'SQFT';
insert into public.job_work_services (code, name, unit_id, is_composite)
select 'DOUBLE_PASTE', 'Double Pasting', u.id, true from public.units u where u.code = 'SQFT';

insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 1, 1 from public.job_work_services s, public.job_work_services c
where s.code = 'SS_CUT' and c.code = 'CUTTING';
insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 1, 2 from public.job_work_services s, public.job_work_services c
where s.code = 'SS_CUT' and c.code = 'PASTING';

insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 1, 1 from public.job_work_services s, public.job_work_services c
where s.code = 'DS_CUT' and c.code = 'CUTTING';
insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 2, 2 from public.job_work_services s, public.job_work_services c
where s.code = 'DS_CUT' and c.code = 'PASTING';

insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 1, 1 from public.job_work_services s, public.job_work_services c
where s.code = 'SINGLE_PASTE' and c.code = 'PASTING';

insert into public.job_work_components (service_id, component_service_id, multiplier, sort_order)
select s.id, c.id, 2, 1 from public.job_work_services s, public.job_work_services c
where s.code = 'DOUBLE_PASTE' and c.code = 'PASTING';
