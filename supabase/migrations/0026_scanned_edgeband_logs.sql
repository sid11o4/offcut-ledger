-- Scan the paper "PVC Edgebanding Usage Log" and extract exactly the three fields that matter
-- -- Project, Edgeband Thickness, Total Meters -- instead of re-typing each row by hand.
-- Extraction (extract-edgeband-scan Edge Function, using Claude's vision) only ever writes to
-- the two staging tables below. A human must review and confirm each row from the Daily Log
-- UI; only that confirmation calls record_job_work_entry() -- the same RPC the manual form
-- uses. The calculation engine, rates and billing are completely untouched.

-- The paper counter is in running METERS; job-work items are currently rated in R.ft. Add
-- Meter as a selectable unit so a scanned reading can be logged (and rated) without a manual
-- conversion.
insert into public.units (code, name, description)
values ('MTR', 'Meter', 'Running metres, e.g. an edgebander''s counter reading.')
on conflict (code) do nothing;

create table public.scanned_edgeband_batches (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  image_path text not null,
  status text not null default 'pending' check (status in ('pending', 'extracted', 'failed', 'reviewed')),
  error text,
  raw_extraction jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

create table public.scanned_edgeband_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.scanned_edgeband_batches(id) on delete cascade,
  row_no int not null,
  project_text text,
  project_id uuid references public.projects(id),
  edgeband_text text,
  service_id uuid references public.job_work_services(id),
  total_meters numeric(14, 4),
  flag text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'skipped')),
  entry_id uuid references public.job_work_entries(id),
  created_at timestamptz not null default now()
);
create index idx_scanned_rows_batch on public.scanned_edgeband_rows(batch_id);

alter table public.scanned_edgeband_batches enable row level security;
alter table public.scanned_edgeband_rows enable row level security;

-- Any active user can scan a log and review it -- the same access level as the manual Daily
-- Log form (record_job_work_entry has no extra permission gate beyond being an active user).
-- The Edge Function itself uses the service-role key and bypasses these policies entirely.
create policy scanned_batches_select on public.scanned_edgeband_batches
  for select using (public.is_active_user());
create policy scanned_batches_insert on public.scanned_edgeband_batches
  for insert with check (public.is_active_user() and created_by = auth.uid());
create policy scanned_batches_update on public.scanned_edgeband_batches
  for update using (public.is_active_user());

create policy scanned_rows_select on public.scanned_edgeband_rows
  for select using (public.is_active_user());
create policy scanned_rows_update on public.scanned_edgeband_rows
  for update using (public.is_active_user());
-- No insert/delete policy for authenticated: rows are only ever written by the Edge Function
-- (service role) during extraction.

-- Private storage bucket for the uploaded photos.
insert into storage.buckets (id, name, public)
values ('scan-uploads', 'scan-uploads', false)
on conflict (id) do nothing;

create policy scan_uploads_insert on storage.objects for insert
  with check (bucket_id = 'scan-uploads' and public.is_active_user());
create policy scan_uploads_select on storage.objects for select
  using (bucket_id = 'scan-uploads' and public.is_active_user());
