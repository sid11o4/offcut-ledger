-- Quotation reading: the Claude-extracted lines are kept on the quotation, and each scope row
-- records which quotation revision produced it, so a later revision can be applied as changes.
alter table public.project_quotations
  add column if not exists extracted jsonb,
  add column if not exists extracted_at timestamptz,
  add column if not exists applied_at timestamptz;

alter table public.project_scope_items
  add column if not exists source_quotation_id uuid references public.project_quotations(id) on delete set null;
