-- Supplier contact details read off a scanned bill (GSTIN, phone, address), kept on the bill so the
-- Bill Audit Queue can offer to add an unrecognised supplier to the suppliers master.
alter table public.supplier_bills
  add column if not exists supplier_details jsonb not null default '{}'::jsonb;
