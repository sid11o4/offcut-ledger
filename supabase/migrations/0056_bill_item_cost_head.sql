-- Each supplier bill line carries its own cost head, assigned by the scan and correctable by hand.
-- The bill-level cost heads and expense nature are now derived from the lines, so they are indicative only.
alter table public.supplier_bill_items add column if not exists cost_head text;

alter table public.supplier_bill_items drop constraint if exists chk_bill_item_cost_head;
alter table public.supplier_bill_items add constraint chk_bill_item_cost_head check (
  cost_head is null or cost_head in ('factory_labour','factory_consumables','site_labour','raw_boards',
    'laminate_veneer','fevicol_adhesives','employee_salary','other')
);
