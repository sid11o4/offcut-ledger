-- Material lines on supplier bills are costed to Raw Boards, Skins, Edgeband, Hardware or Others (the
-- same groups as the inventory); labour lines keep Factory Labour, Site Labour and Employee Salary.
-- The old heads are folded in: Laminate and Veneer became Skins, and Factory Consumables and
-- Fevicol / Adhesives became Others.

alter table public.supplier_bill_items drop constraint if exists chk_bill_item_cost_head;
alter table public.supplier_bills drop constraint if exists chk_cost_heads_valid;

update public.supplier_bill_items set cost_head = case cost_head
  when 'laminate_veneer' then 'skins'
  when 'fevicol_adhesives' then 'other'
  when 'factory_consumables' then 'other' end
where cost_head in ('laminate_veneer', 'fevicol_adhesives', 'factory_consumables');

update public.supplier_bills b set cost_heads = coalesce((
  select array_agg(distinct h) from (
    select case x when 'laminate_veneer' then 'skins' when 'fevicol_adhesives' then 'other'
                  when 'factory_consumables' then 'other' else x end as h
    from unnest(b.cost_heads) x
  ) m
), '{}')
where cost_heads && array['laminate_veneer', 'fevicol_adhesives', 'factory_consumables']::text[];

alter table public.supplier_bill_items add constraint chk_bill_item_cost_head check (
  cost_head is null or cost_head in ('raw_boards', 'skins', 'edgeband', 'hardware', 'other',
    'factory_labour', 'site_labour', 'employee_salary')
);
alter table public.supplier_bills add constraint chk_cost_heads_valid check (
  cost_heads <@ array['raw_boards', 'skins', 'edgeband', 'hardware', 'other',
    'factory_labour', 'site_labour', 'employee_salary']::text[]
);
