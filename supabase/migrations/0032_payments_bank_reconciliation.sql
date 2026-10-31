-- Payment allocation + bank reconciliation (business context, Oct 2026). Three states that
-- must never be conflated, per spec: amount ALLOCATED to a payment mode, amount the bank has
-- ACTUALLY confirmed (reconciled), and amount still PAYABLE (unpaid credit). An RTGS/NEFT
-- allocation is a payment INSTRUCTION, never proof of payment, until matched here.

create table public.supplier_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.supplier_bills(id) on delete cascade,
  mode text not null check (mode in ('cash','rtgs_neft','credit')),
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  remarks text,
  utr_reference text, -- written on the slip at allocation time, if known
  -- Cash: paid in hand. RTGS/NEFT and credit: confirmed only once reconciled against an
  -- actual bank transaction (rtgs_neft) or, for credit, when the accountant separately marks
  -- it settled -- never implied just by recording the allocation.
  confirmed boolean not null default false,
  confirmed_amount numeric(14,2),
  confirmed_at timestamptz,
  bank_transaction_id uuid, -- fk added after bank_transactions exists, below
  received_by text, -- cash-receipt section of the slip
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_supplier_bill_payments_bill on public.supplier_bill_payments(bill_id);

-- Cash is confirmed the moment it's recorded -- there's no separate reconciliation step for
-- cash in hand, unlike a bank transfer or a credit balance later settled.
create or replace function public.supplier_bill_payments_cash_confirm()
returns trigger language plpgsql as $$
begin
  if new.mode = 'cash' then
    new.confirmed := true;
    new.confirmed_amount := new.allocated_amount;
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;
create trigger trg_supplier_bill_payments_cash_confirm before insert on public.supplier_bill_payments
  for each row execute function public.supplier_bill_payments_cash_confirm();

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  row_count int not null default 0,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now()
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports(id) on delete cascade,
  txn_date date not null,
  description text,
  debit_amount numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  balance numeric(14,2),
  utr_reference text,
  raw_row jsonb not null default '{}',
  -- A statement re-imported over the same period must not duplicate rows. Populated by the
  -- trigger below rather than GENERATED ALWAYS AS, since a date->text cast isn't considered
  -- immutable (its format depends on the session's DateStyle setting).
  dedupe_key text not null default '',
  matched boolean not null default false,
  matched_payment_id uuid references public.supplier_bill_payments(id),
  created_at timestamptz not null default now()
);

create or replace function public.bank_transactions_set_dedupe_key()
returns trigger language plpgsql as $$
begin
  new.dedupe_key := md5(new.txn_date::text || '|' || coalesce(new.description, '') || '|' ||
    new.debit_amount::text || '|' || new.credit_amount::text || '|' || coalesce(new.utr_reference, ''));
  return new;
end;
$$;
create trigger trg_bank_transactions_dedupe before insert on public.bank_transactions
  for each row execute function public.bank_transactions_set_dedupe_key();

create unique index uq_bank_transactions_dedupe on public.bank_transactions(dedupe_key);
create index idx_bank_transactions_matched on public.bank_transactions(matched);

alter table public.supplier_bill_payments
  add constraint fk_supplier_bill_payments_bank_txn
  foreign key (bank_transaction_id) references public.bank_transactions(id);

-- Candidate matches for one bank debit: unconfirmed RTGS/NEFT allocations within +/-1% of its
-- amount. Candidates only -- the UI still requires the accountant to pick one; nothing here
-- auto-confirms, and conflicting evidence (a UTR that doesn't match) is surfaced, not hidden.
create or replace function public.suggest_bank_matches(p_bank_transaction_id uuid)
returns table (
  payment_id uuid, bill_id uuid, internal_bill_number text, supplier_name text,
  allocated_amount numeric, utr_reference text, utr_matches boolean, amount_diff_pct numeric
)
language sql stable set search_path = public as $$
  select p.id, p.bill_id, b.internal_bill_number, s.name, p.allocated_amount, p.utr_reference,
    (p.utr_reference is not null and p.utr_reference = bt.utr_reference) as utr_matches,
    round(abs(p.allocated_amount - bt.debit_amount) / nullif(bt.debit_amount, 0) * 100, 2) as amount_diff_pct
  from public.bank_transactions bt
  join public.supplier_bill_payments p on p.mode = 'rtgs_neft' and p.confirmed = false
  join public.supplier_bills b on b.id = p.bill_id
  left join public.suppliers s on s.id = b.supplier_id
  where bt.id = p_bank_transaction_id
    and bt.debit_amount > 0
    and abs(p.allocated_amount - bt.debit_amount) <= bt.debit_amount * 0.01
  order by utr_matches desc, amount_diff_pct asc;
$$;

-- Confirms one match: the only way a payment's confirmed/confirmed_amount/bank_transaction_id
-- get set for a non-cash mode. Refuses a bank transaction that's already matched, or confirming
-- the same payment twice, so duplicate confirmations are impossible.
create or replace function public.confirm_bank_match(p_bank_transaction_id uuid, p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bt record;
  v_payment record;
begin
  if not public.has_permission('bank_reconciliation') then
    raise exception 'You do not have permission to reconcile bank transactions.';
  end if;

  select * into v_bt from public.bank_transactions where id = p_bank_transaction_id for update;
  if v_bt.id is null then raise exception 'Bank transaction not found.'; end if;
  if v_bt.matched then raise exception 'This bank transaction is already matched.'; end if;

  select * into v_payment from public.supplier_bill_payments where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'Payment allocation not found.'; end if;
  if v_payment.confirmed then raise exception 'This payment is already confirmed.'; end if;
  if v_payment.mode <> 'rtgs_neft' then raise exception 'Only an RTGS/NEFT allocation can be bank-matched.'; end if;

  update public.bank_transactions set matched = true, matched_payment_id = p_payment_id
    where id = p_bank_transaction_id;
  update public.supplier_bill_payments
    set confirmed = true, confirmed_amount = v_bt.debit_amount, confirmed_at = now(),
        bank_transaction_id = p_bank_transaction_id
    where id = p_payment_id;
end;
$$;

grant execute on function
  public.suggest_bank_matches(uuid),
  public.confirm_bank_match(uuid, uuid)
to authenticated;
