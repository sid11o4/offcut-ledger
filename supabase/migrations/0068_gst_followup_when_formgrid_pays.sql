-- Whenever FORMGRID pays a bill that has taxed items by RTGS/NEFT, the GST follow-up is raised.
-- It is checked again whenever a payment is recorded on an approved FORMGRID bill.
create or replace function public.ensure_gst_followup(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill record;
  v_has_gst boolean;
  v_has_paid boolean;
  v_already boolean;
begin
  select bill_source, status into v_bill from public.supplier_bills where id = p_bill_id;
  if v_bill.bill_source is distinct from 'formgrid' or v_bill.status is distinct from 'approved' then return; end if;

  select exists (
    select 1 from public.supplier_bill_items where bill_id = p_bill_id and gst_percent > 0
  ) into v_has_gst;
  select exists (
    select 1 from public.supplier_bill_payments
    where bill_id = p_bill_id and mode = 'rtgs_neft' and allocated_amount > 0
  ) into v_has_paid;
  select exists (select 1 from public.gst_invoice_followups where bill_id = p_bill_id) into v_already;

  if v_has_gst and v_has_paid and not v_already then
    insert into public.gst_invoice_followups (bill_id, status, next_action)
    values (p_bill_id, 'pending', 'Request the official GST invoice from the supplier.');
    insert into public.itc_status (bill_id) values (p_bill_id)
    on conflict (bill_id) do nothing;
  end if;
end;
$function$;

revoke all on function public.ensure_gst_followup(uuid) from public, anon;
grant execute on function public.ensure_gst_followup(uuid) to authenticated;

create or replace function public.supplier_bill_payments_gst_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.ensure_gst_followup(new.bill_id);
  return new;
end;
$function$;

revoke all on function public.supplier_bill_payments_gst_followup() from public, anon, authenticated;

drop trigger if exists supplier_bill_payments_gst_followup on public.supplier_bill_payments;
create trigger supplier_bill_payments_gst_followup
  after insert on public.supplier_bill_payments
  for each row execute function public.supplier_bill_payments_gst_followup();
