-- Project receivables: the client's quotation, the scope of work (with additions and reductions), and
-- payments collected against it, each with a FORMGRID receipt number.

create table if not exists public.project_quotations (
  id uuid primary key default gen_random_uuid(),
  design_project_id uuid not null references public.design_projects(id) on delete cascade,
  label text not null default 'Quotation',
  quoted_total numeric(14,2) not null default 0,
  quoted_on date not null default current_date,
  file_path text,
  file_name text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.project_scope_items (
  id uuid primary key default gen_random_uuid(),
  design_project_id uuid not null references public.design_projects(id) on delete cascade,
  kind text not null default 'original' check (kind in ('original', 'added', 'reduced')),
  description text not null,
  unit_text text,
  quantity numeric(14,4) not null default 1,
  rate numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create sequence if not exists public.project_receipt_seq;

create table if not exists public.project_collections (
  id uuid primary key default gen_random_uuid(),
  design_project_id uuid not null references public.design_projects(id) on delete cascade,
  receipt_no text not null unique,
  receipt_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null check (mode in ('cash', 'cheque', 'rtgs_neft', 'upi', 'other')),
  reference text,
  received_from text,
  notes text,
  voided boolean not null default false,
  void_reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_quotations_project on public.project_quotations(design_project_id);
create index if not exists idx_project_scope_project on public.project_scope_items(design_project_id);
create index if not exists idx_project_collections_project on public.project_collections(design_project_id);

alter table public.project_quotations enable row level security;
alter table public.project_scope_items enable row level security;
alter table public.project_collections enable row level security;

create policy project_quotations_all on public.project_quotations for all to authenticated
  using (public.has_permission('design_build_manage')) with check (public.has_permission('design_build_manage'));
create policy project_scope_all on public.project_scope_items for all to authenticated
  using (public.has_permission('design_build_manage')) with check (public.has_permission('design_build_manage'));
create policy project_collections_all on public.project_collections for all to authenticated
  using (public.has_permission('design_build_manage')) with check (public.has_permission('design_build_manage'));

-- Contract value: the scope of work (additions less reductions) when there is one, otherwise the latest quotation.
create or replace function public.project_contract_summary(p_design_project_id uuid)
returns table(contract_total numeric, received_total numeric, balance_due numeric, scope_count integer, quotation_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when (select count(*) from public.project_scope_items s where s.design_project_id = p_design_project_id) > 0
      then (select coalesce(sum(s.amount), 0) from public.project_scope_items s where s.design_project_id = p_design_project_id)
      else coalesce((select q.quoted_total from public.project_quotations q where q.design_project_id = p_design_project_id order by q.created_at desc limit 1), 0)
    end,
    coalesce((select sum(c.amount) from public.project_collections c where c.design_project_id = p_design_project_id and not c.voided), 0),
    0,
    (select count(*)::int from public.project_scope_items s where s.design_project_id = p_design_project_id),
    (select count(*)::int from public.project_quotations q where q.design_project_id = p_design_project_id)
$$;

create or replace function public.record_project_collection(
  p_design_project_id uuid, p_amount numeric, p_mode text, p_date date,
  p_reference text, p_received_from text, p_notes text)
returns public.project_collections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.project_collections;
begin
  if not public.has_permission('design_build_manage') then
    raise exception 'You do not have permission to record payments for projects.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount received must be greater than zero.'; end if;
  if not exists (select 1 from public.design_projects where id = p_design_project_id) then
    raise exception 'Project not found.';
  end if;
  insert into public.project_collections (design_project_id, receipt_no, receipt_date, amount, mode, reference, received_from, notes)
  values (p_design_project_id, 'RCT-' || lpad(nextval('public.project_receipt_seq')::text, 4, '0'),
    coalesce(p_date, current_date), p_amount, p_mode, nullif(p_reference, ''), nullif(p_received_from, ''), nullif(p_notes, ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.void_project_collection(p_collection_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('design_build_manage') then
    raise exception 'You do not have permission to void receipts.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for voiding the receipt.'; end if;
  update public.project_collections set voided = true, void_reason = p_reason where id = p_collection_id and not voided;
  if not found then raise exception 'Receipt not found or already voided.'; end if;
end;
$$;

revoke all on function public.project_contract_summary(uuid) from public, anon;
revoke all on function public.record_project_collection(uuid, numeric, text, date, text, text, text) from public, anon;
revoke all on function public.void_project_collection(uuid, text) from public, anon;
grant execute on function public.project_contract_summary(uuid) to authenticated;
grant execute on function public.record_project_collection(uuid, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.void_project_collection(uuid, text) to authenticated;
