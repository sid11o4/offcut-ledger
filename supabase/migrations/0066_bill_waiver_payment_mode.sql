-- A FORMGRID bill can be settled with a round-off or waive-off, so its total reaches zero. A waiver is
-- an allocation of the bill's amount that is not paid out.
alter table public.supplier_bill_payments drop constraint if exists supplier_bill_payments_mode_check;
alter table public.supplier_bill_payments add constraint supplier_bill_payments_mode_check
  check (mode = any (array['cash'::text, 'rtgs_neft'::text, 'credit'::text, 'waiver'::text]));
