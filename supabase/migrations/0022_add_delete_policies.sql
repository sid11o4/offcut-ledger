-- Allow hard-deleting configuration rows (masters, clients, projects, rates) that nothing
-- references yet -- the app previously only offered soft-deactivation. Requested by the
-- factory owner while setting up: you need to be able to remove a machine/service/client/
-- rate you added by mistake.
--
-- Transactional/financial records (job_work_entries, bills, estimates, expenses,
-- recurring_expenses) deliberately keep their cancel/void/deactivate paths instead -- spec
-- sections 19 & 38 ("avoid destructive hard deletion of financial records", "maintain audit
-- history"). Deleting a referenced config row is still refused, but now by a plain foreign-key
-- constraint (Postgres error 23503) which the UI turns into "this is in use -- deactivate it
-- instead" rather than exposing the raw error (spec section 54).
--
-- The audit trigger (0011) already fires on DELETE, so every delete here is still recorded.

create policy units_delete on public.units for delete using (public.has_permission('master_data'));
create policy machines_delete on public.machines for delete using (public.has_permission('master_data'));
create policy processes_delete on public.processes for delete using (public.has_permission('master_data'));
create policy rate_categories_delete on public.rate_categories for delete using (public.has_permission('master_data'));
create policy expense_categories_delete on public.expense_categories for delete using (public.has_permission('master_data'));
create policy job_work_services_delete on public.job_work_services for delete using (public.has_permission('master_data'));

create policy clients_delete on public.clients for delete using (public.has_permission('project_manage'));
create policy projects_delete on public.projects for delete using (public.has_permission('project_manage'));

-- Rates were previously append-only (no update/delete policy at all -- history is corrected by
-- inserting a new effective-dated row). A delete path is added now so a wrong rate entered
-- during setup can be removed outright; once a rate has priced a real job-work entry, the FK
-- from job_work_entry_components.rate_id blocks its deletion, preserving history exactly as
-- before.
create policy rates_delete on public.rates for delete using (public.has_permission('rate_management'));
