-- Row Level Security. This is the real authorization boundary -- the UI hides controls for
-- convenience, but every table enforces the same rule server-side (spec section 56: "Never
-- rely on UI hiding to enforce permissions").
--
-- Permission keys used throughout (seeded in 0015 with per-role defaults):
--   master_data       machines/processes/units/services/components/rate_categories/expense_categories
--   project_manage    clients/projects
--   rate_management   rates
--   rate_override     override an auto-selected rate on a job-work entry
--   billing           generate/view bills
--   bill_cancel       cancel a bill
--   estimates         create/edit estimates
--   expense_manage    recurring expenses CRUD, void an expense
--   historical_edit   edit/cancel job-work entries and expenses after creation
--   financial_reports view income/expense statement and factory-wide financial reports
--   user_manage       manage users, roles, role_permissions

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.units enable row level security;
alter table public.machines enable row level security;
alter table public.processes enable row level security;
alter table public.rate_categories enable row level security;
alter table public.expense_categories enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.job_work_services enable row level security;
alter table public.job_work_components enable row level security;
alter table public.rates enable row level security;
alter table public.daily_logs enable row level security;
alter table public.job_work_entries enable row level security;
alter table public.job_work_entry_components enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_items enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

-- Reference/config data: readable by any active user, writable by the matching permission.
-- Insert/update/delete are three separate policies rather than one `for all` so that a plain
-- SELECT only ever evaluates the one read policy (a `for all` policy is also permissive for
-- SELECT, and Postgres must evaluate every permissive policy that applies -- see spec 55/57).
create policy roles_select on public.roles for select using (public.is_active_user());
create policy roles_insert on public.roles for insert with check (public.has_permission('user_manage'));
create policy roles_update on public.roles for update using (public.has_permission('user_manage'));
create policy roles_delete on public.roles for delete using (public.has_permission('user_manage'));

create policy permissions_select on public.permissions for select using (public.is_active_user());

create policy role_permissions_select on public.role_permissions for select using (public.is_active_user());
create policy role_permissions_insert on public.role_permissions for insert with check (public.has_permission('user_manage'));
create policy role_permissions_update on public.role_permissions for update using (public.has_permission('user_manage'));
create policy role_permissions_delete on public.role_permissions for delete using (public.has_permission('user_manage'));

-- auth.uid() is wrapped as (select auth.uid()) throughout this file: it makes Postgres
-- evaluate it once per statement via an InitPlan instead of once per row (spec section 55).
create policy profiles_select on public.profiles for select using (public.is_active_user());
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid()) or public.has_permission('user_manage'))
  with check (id = (select auth.uid()) or public.has_permission('user_manage'));
create policy profiles_insert_admin on public.profiles for insert with check (public.has_permission('user_manage'));

-- prevent_self_role_escalation: the profiles_update policy above lets a user update their own
-- row (so they can fix their name/phone), but must not let them grant themselves a bigger role.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.id and not public.has_permission('user_manage') then
    if new.role_id is distinct from old.role_id or new.active is distinct from old.active then
      raise exception 'You cannot change your own role or active status.';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_prevent_self_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

create policy units_select on public.units for select using (public.is_active_user());
create policy units_write on public.units for insert with check (public.has_permission('master_data'));
create policy units_update on public.units for update using (public.has_permission('master_data'));

create policy machines_select on public.machines for select using (public.is_active_user());
create policy machines_write on public.machines for insert with check (public.has_permission('master_data'));
create policy machines_update on public.machines for update using (public.has_permission('master_data'));

create policy processes_select on public.processes for select using (public.is_active_user());
create policy processes_write on public.processes for insert with check (public.has_permission('master_data'));
create policy processes_update on public.processes for update using (public.has_permission('master_data'));

create policy rate_categories_select on public.rate_categories for select using (public.is_active_user());
create policy rate_categories_write on public.rate_categories for insert with check (public.has_permission('master_data'));
create policy rate_categories_update on public.rate_categories for update using (public.has_permission('master_data'));

create policy expense_categories_select on public.expense_categories for select using (public.is_active_user());
create policy expense_categories_write on public.expense_categories for insert with check (public.has_permission('master_data'));
create policy expense_categories_update on public.expense_categories for update using (public.has_permission('master_data'));

create policy job_work_services_select on public.job_work_services for select using (public.is_active_user());
create policy job_work_services_write on public.job_work_services for insert with check (public.has_permission('master_data'));
create policy job_work_services_update on public.job_work_services for update using (public.has_permission('master_data'));

create policy job_work_components_select on public.job_work_components for select using (public.is_active_user());
create policy job_work_components_write on public.job_work_components for insert with check (public.has_permission('master_data'));
create policy job_work_components_update on public.job_work_components for update using (public.has_permission('master_data'));
create policy job_work_components_delete on public.job_work_components for delete using (public.has_permission('master_data'));

create policy rates_select on public.rates for select using (public.is_active_user());
create policy rates_write on public.rates for insert with check (public.has_permission('rate_management'));
-- No update/delete policy on rates: history is append-only, corrected only by inserting a new
-- effective-dated row (see 0006). An admin data fix on a genuinely wrong historical row must
-- go through the Supabase dashboard/service role, not the app.

create policy clients_select on public.clients for select using (public.is_active_user());
create policy clients_write on public.clients for insert with check (public.has_permission('project_manage'));
create policy clients_update on public.clients for update using (public.has_permission('project_manage'));

create policy projects_select on public.projects for select using (public.is_active_user());
create policy projects_write on public.projects for insert with check (public.has_permission('project_manage'));
create policy projects_update on public.projects for update using (public.has_permission('project_manage'));

create policy daily_logs_select on public.daily_logs for select using (public.is_active_user());
create policy daily_logs_update on public.daily_logs for update using (public.has_permission('historical_edit'));

create policy job_work_entries_select on public.job_work_entries for select using (public.is_active_user());
create policy job_work_entries_insert on public.job_work_entries for insert
  with check (public.is_active_user() and created_by = (select auth.uid()));
create policy job_work_entries_update on public.job_work_entries for update
  using (public.has_permission('historical_edit'));

create policy job_work_entry_components_select on public.job_work_entry_components for select using (public.is_active_user());
create policy job_work_entry_components_insert on public.job_work_entry_components for insert with check (public.is_active_user());

create policy estimates_select on public.estimates for select using (public.is_active_user());
create policy estimates_write on public.estimates for insert with check (public.has_permission('estimates'));
create policy estimates_update on public.estimates for update using (public.has_permission('estimates'));

create policy estimate_items_select on public.estimate_items for select using (public.is_active_user());
create policy estimate_items_write on public.estimate_items for insert with check (public.has_permission('estimates'));
create policy estimate_items_update on public.estimate_items for update using (public.has_permission('estimates'));
create policy estimate_items_delete on public.estimate_items for delete using (public.has_permission('estimates'));

create policy bills_select on public.bills for select
  using (public.has_permission('billing') or public.has_permission('financial_reports'));
create policy bills_insert on public.bills for insert with check (public.has_permission('billing'));
create policy bills_update on public.bills for update
  using (public.has_permission('billing') or public.has_permission('bill_cancel'));

create policy bill_items_select on public.bill_items for select
  using (public.has_permission('billing') or public.has_permission('financial_reports'));
create policy bill_items_insert on public.bill_items for insert with check (public.has_permission('billing'));

create policy recurring_expenses_select on public.recurring_expenses for select using (public.is_active_user());
create policy recurring_expenses_write on public.recurring_expenses for insert with check (public.has_permission('expense_manage'));
create policy recurring_expenses_update on public.recurring_expenses for update using (public.has_permission('expense_manage'));

create policy expenses_select on public.expenses for select using (public.is_active_user());
create policy expenses_insert on public.expenses for insert
  with check (public.is_active_user() and (source = 'manual' and created_by = (select auth.uid())));
create policy expenses_update on public.expenses for update
  using (public.has_permission('historical_edit') or public.has_permission('expense_manage'));

create policy audit_logs_select on public.audit_logs for select using (public.has_permission('financial_reports') or public.has_permission('user_manage'));
