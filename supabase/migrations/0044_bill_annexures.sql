-- Annexures: the vendor-side bill and GST invoices that go with a FORMGRID bill slip. They are
-- stored against the bill and shown in its details, so the audit trail keeps them together.
create table if not exists public.supplier_bill_annexures (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.supplier_bills(id) on delete cascade,
  kind text not null check (kind in ('vendor_bill', 'gst_invoice', 'other')),
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_bill_annexures_bill on public.supplier_bill_annexures (bill_id);

alter table public.supplier_bill_annexures enable row level security;

create policy supplier_bill_annexures_select on public.supplier_bill_annexures for select
  using (public.has_permission('supplier_bills_manage') or public.has_permission('financial_reports'));

create policy supplier_bill_annexures_insert on public.supplier_bill_annexures for insert
  with check (public.has_permission('supplier_bills_manage'));

-- Annexures can be re-classified or removed only while the bill is still pending review.
create policy supplier_bill_annexures_update on public.supplier_bill_annexures for update
  using (
    public.has_permission('supplier_bills_manage')
    and exists (select 1 from public.supplier_bills b where b.id = bill_id and b.status = 'pending_review')
  );

create policy supplier_bill_annexures_delete on public.supplier_bill_annexures for delete
  using (
    public.has_permission('supplier_bills_manage')
    and exists (select 1 from public.supplier_bills b where b.id = bill_id and b.status = 'pending_review')
  );

create trigger trg_audit_supplier_bill_annexures
  after insert or update or delete on public.supplier_bill_annexures
  for each row execute function public.audit_row_change();
