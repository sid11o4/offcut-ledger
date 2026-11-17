-- Processing a return writes the slip, its lines and the stock movements. The tables only have read policies
-- (writes go through functions), and these two functions ran as the caller, so a return failed with
-- "new row violates row-level security policy". Each checks the permission itself, so they now run with the
-- owner's rights like the other return and stock functions.
alter function public.create_supplier_return(uuid, uuid, date, text, jsonb) security definer set search_path = public;
alter function public.file_return_slip(uuid, text, date) security definer set search_path = public;
