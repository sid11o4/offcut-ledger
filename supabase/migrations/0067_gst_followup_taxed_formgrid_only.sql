-- The GST follow-up is raised only for FORMGRID bills, and only when the bill has taxed items.
create or replace function public.ensure_gst_followup(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_formgrid boolean;
  v_has_gst boolean;
  v_has_rtgs boolean;
  v_already boolean;
begin
  select bill_source = 'formgrid' into v_is_formgrid from public.supplier_bills where id = p_bill_id;
  if not coalesce(v_is_formgrid, false) then return; end if;

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
$function$;

revoke all on function public.ensure_gst_followup(uuid) from public, anon;
grant execute on function public.ensure_gst_followup(uuid) to authenticated;
