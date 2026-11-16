-- The GST invoice follow-up is raised once an RTGS/NEFT payment is confirmed against the bank
-- statement (the money has actually left), not when the payment is merely marked as RTGS/NEFT.
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
    where bill_id = p_bill_id and mode = 'rtgs_neft' and allocated_amount > 0 and confirmed
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

drop trigger if exists supplier_bill_payments_gst_followup on public.supplier_bill_payments;
create trigger supplier_bill_payments_gst_followup
  after insert or update of confirmed on public.supplier_bill_payments
  for each row execute function public.supplier_bill_payments_gst_followup();

-- Payments already confirmed whose bill has no follow-up yet.
select public.ensure_gst_followup(bill_id)
from (select distinct bill_id from public.supplier_bill_payments where mode = 'rtgs_neft' and confirmed) x;
