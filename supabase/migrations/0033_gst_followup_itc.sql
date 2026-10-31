-- GST invoice follow-up + ITC tracking (business context, Oct 2026). Exact trigger condition
-- from the spec: a bill with a GST>0% line AND an RTGS/NEFT allocation enters follow-up if its
-- official supplier GST invoice hasn't been received and verified. ITC eligibility is tracked
-- as a chain of independent statuses -- never implied just because GST% > 0.

create table public.gst_invoice_followups (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null unique references public.supplier_bills(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','contacted','received','verified','closed')),
  official_invoice_number text,
  official_invoice_date date,
  official_invoice_image_path text,
  gstin_check text, -- free text note: match / mismatch / not checked
  portal_match_status text not null default 'not_checked'
    check (portal_match_status in ('not_checked','matched','missing','discrepancy')),
  discrepancy_notes text,
  last_follow_up_at timestamptz,
  last_follow_up_note text,
  next_action text,
  responsible_user_id uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_gst_invoice_followups_updated_at before update on public.gst_invoice_followups
  for each row execute function public.set_updated_at();

create table public.itc_status (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null unique references public.supplier_bills(id) on delete cascade,
  invoice_received boolean not null default false,
  validity_checked boolean not null default false,
  portal_matched boolean not null default false,
  eligible boolean, -- null = not yet assessed
  eligible_note text,
  accountant_approved boolean not null default false,
  claimed boolean not null default false,
  claimed_period text, -- e.g. the GST return period it was claimed in
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create trigger trg_itc_status_updated_at before update on public.itc_status
  for each row execute function public.set_updated_at();

-- Creates the follow-up record exactly when the spec's condition first becomes true. Called
-- from bill approval and from recording an RTGS/NEFT payment -- whichever happens second is
-- what actually creates it, since both conditions must hold.
create or replace function public.ensure_gst_followup(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_gst boolean;
  v_has_rtgs boolean;
  v_already boolean;
begin
  select exists (
    select 1 from public.supplier_bill_items where bill_id = p_bill_id and gst_percent > 0
  ) into v_has_gst;
  select exists (
    select 1 from public.supplier_bill_payments where bill_id = p_bill_id and mode = 'rtgs_neft'
  ) into v_has_rtgs;
  select exists (select 1 from public.gst_invoice_followups where bill_id = p_bill_id) into v_already;

  if v_has_gst and v_has_rtgs and not v_already then
    insert into public.gst_invoice_followups (bill_id, status, next_action)
    values (p_bill_id, 'pending', 'Request the official GST invoice from the supplier.');
    insert into public.itc_status (bill_id) values (p_bill_id)
    on conflict (bill_id) do nothing;
  end if;
end;
$$;

create or replace function public.supplier_bill_payments_check_followup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mode = 'rtgs_neft' then
    perform public.ensure_gst_followup(new.bill_id);
  end if;
  return new;
end;
$$;
create trigger trg_supplier_bill_payments_check_followup after insert on public.supplier_bill_payments
  for each row execute function public.supplier_bill_payments_check_followup();

-- A supplier's promise to send an invoice is not receipt; only this call moves status beyond
-- 'pending'/'contacted'. Receiving sets invoice_received on the ITC chain, but never touches
-- eligible/accountant_approved/claimed -- those stay separate, explicit steps.
create or replace function public.record_gst_invoice_received(
  p_bill_id uuid, p_invoice_number text, p_invoice_date date, p_image_path text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('gst_compliance') then
    raise exception 'You do not have permission to manage GST invoice follow-up.';
  end if;
  update public.gst_invoice_followups
    set status = 'received', official_invoice_number = p_invoice_number,
        official_invoice_date = p_invoice_date, official_invoice_image_path = p_image_path,
        last_follow_up_at = now()
    where bill_id = p_bill_id;
  update public.itc_status set invoice_received = true, updated_by = auth.uid()
    where bill_id = p_bill_id;
end;
$$;

grant execute on function
  public.ensure_gst_followup(uuid),
  public.record_gst_invoice_received(uuid, text, date, text)
to authenticated;

-- 180-day supplier-payment review (derived, not stored, so it can never drift from the real
-- bills/payments data). Flags a bill as "at risk" once it's unpaid (or only credit-allocated)
-- 150+ days after its bill_date -- a 30-day amber window before the statutory 180-day mark, so
-- the accountant has time to act. Never reverses ITC itself -- that stays a human decision.
create or replace function public.report_itc_180day_risk()
returns table (
  bill_id uuid, internal_bill_number text, bill_date date, supplier_name text,
  grand_total numeric, confirmed_paid numeric, outstanding numeric, days_elapsed int, risk_level text
)
language sql stable set search_path = public as $$
  select b.id, b.internal_bill_number, b.bill_date, s.name, b.grand_total,
    coalesce(paid.total, 0),
    b.grand_total - coalesce(paid.total, 0),
    (current_date - b.bill_date),
    case
      when (current_date - b.bill_date) >= 180 then 'breached'
      when (current_date - b.bill_date) >= 150 then 'approaching'
      else 'ok'
    end
  from public.supplier_bills b
  left join public.suppliers s on s.id = b.supplier_id
  left join (
    select bill_id, sum(confirmed_amount) as total
    from public.supplier_bill_payments where confirmed
    group by bill_id
  ) paid on paid.bill_id = b.id
  where b.status = 'approved'
    and b.grand_total - coalesce(paid.total, 0) > 0.01
    and (current_date - b.bill_date) >= 150
  order by (current_date - b.bill_date) desc;
$$;

grant execute on function public.report_itc_180day_risk() to authenticated;

-- approve_supplier_bill (0031) now also checks the follow-up condition on approval, since an
-- RTGS/NEFT allocation can be recorded either before or after approval -- whichever of the two
-- happens second is what actually creates the follow-up (ensure_gst_followup is idempotent).
create or replace function public.approve_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_item record;
  v_location_id uuid;
begin
  if not public.has_permission('supplier_bills_manage') then
    raise exception 'You do not have permission to approve supplier bills.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_bill_id for update;
  if v_bill.id is null then raise exception 'Bill not found.'; end if;
  if v_bill.status <> 'pending_review' then
    raise exception 'Only a bill pending review can be approved.';
  end if;
  if v_bill.supplier_id is null then
    raise exception 'Match this bill to a supplier before approving it.';
  end if;

  if v_bill.design_project_id is not null then
    select id into v_location_id from public.inventory_locations
      where kind = 'project' and design_project_id = v_bill.design_project_id;
  else
    select id into v_location_id from public.inventory_locations where kind = 'company';
  end if;

  for v_item in
    select * from public.supplier_bill_items
    where bill_id = p_bill_id and item_type = 'material' and inventory_item_id is not null
  loop
    if (select track_as_inventory from public.inventory_items where id = v_item.inventory_item_id) then
      perform public.record_inventory_purchase(
        v_item.inventory_item_id, v_location_id, v_item.quantity,
        v_item.total_amount / v_item.quantity, v_bill.bill_date,
        'supplier_bill', p_bill_id, 'Supplier bill ' || v_bill.internal_bill_number);
    end if;
  end loop;

  update public.supplier_bills
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_bill_id;

  perform public.ensure_gst_followup(p_bill_id);
end;
$$;
