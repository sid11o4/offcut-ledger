-- False Ceiling is its own cost group (it was lumped with hardware on C1's list).
insert into public.expense_categories (code, name)
select 'FALSE_CEILING', 'False Ceiling' where not exists (select 1 from public.expense_categories where name = 'False Ceiling');

create or replace function public.design_cost_group_of_expense(p_name text)
returns text[] language sql immutable as $$
  select case
    when p_name in ('Labour', 'Fixed Salaries') then array['Labour', null]
    when p_name = 'Transport' then array['Transport', null]
    when p_name = 'False Ceiling' then array['False Ceiling', null]
    when p_name = 'Consumables' then array['Materials', 'Adhesives']
    else array['Miscellaneous', null]
  end;
$$;

-- C1's own list: costs already incurred before the system held stock. Nothing is taken from inventory.
do $$
declare
  c1 uuid := '335da21f-1611-43a4-bcbe-e0c2efe0b1a0';
  rm uuid := (select id from public.units where code = 'RM' and active);
  nos uuid := (select id from public.units where code = 'NOS' and active);
  cat_lab uuid := (select id from public.expense_categories where name = 'Labour');
  cat_trn uuid := (select id from public.expense_categories where name = 'Transport');
  cat_fc uuid := (select id from public.expense_categories where name = 'False Ceiling');
  i3088 uuid; i1181 uuid; iven uuid; iaruna uuid; ibalaji uuid;
begin
  if exists (select 1 from public.past_material_consumption p join public.inventory_items i on i.id = p.item_id
             where p.design_project_id = c1 and i.category = 'Edgeband' and not p.voided) then
    raise exception 'C1 already has past edgeband entries';
  end if;

  select id into i3088 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('3088 0.8') and active limit 1;
  if i3088 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('3088 0.8', rm, true, 'Edgeband') returning id into i3088; end if;
  select id into i1181 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('1181 2mm') and active limit 1;
  if i1181 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('1181 2mm', rm, true, 'Edgeband') returning id into i1181; end if;
  select id into iven from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('Veneer') and active limit 1;
  if iven is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Veneer', rm, true, 'Edgeband') returning id into iven; end if;
  -- Hardware bought from the plywood shops has no item list, so each shop is one cost line item, not stocked.
  select id into iaruna from public.inventory_items where name = 'Hardware - Aruna Plywood' limit 1;
  if iaruna is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Hardware - Aruna Plywood', nos, false, 'Hardware') returning id into iaruna; end if;
  select id into ibalaji from public.inventory_items where name = 'Hardware - Balaji Plywood' limit 1;
  if ibalaji is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Hardware - Balaji Plywood', nos, false, 'Hardware') returning id into ibalaji; end if;

  insert into public.past_material_consumption (design_project_id, item_id, quantity, unit_cost, consumed_on, note) values
    (c1, i3088, 52.8, 17, '2026-11-17', 'C1 list: edgeband #10'),
    (c1, i3088, 85.6, 17, '2026-11-17', 'C1 list: edgeband #11'),
    (c1, iven, 19.34, 69, '2026-11-17', 'C1 list: edgeband #12'),
    (c1, i3088, 285.73, 17, '2026-11-17', 'C1 list: edgeband #13'),
    (c1, i3088, 46.41, 17, '2026-11-17', 'C1 list: edgeband #14'),
    (c1, i3088, 38.28, 17, '2026-11-17', 'C1 list: edgeband #15'),
    (c1, iven, 9.75, 69, '2026-11-17', 'C1 list: edgeband #16'),
    (c1, i1181, 78.86, 34, '2026-11-17', 'C1 list: edgeband #17'),
    (c1, i3088, 71.14, 17, '2026-11-17', 'C1 list: edgeband #18'),
    (c1, iven, 33.66, 69, '2026-11-17', 'C1 list: edgeband #19'),
    (c1, iven, 47.66, 69, '2026-11-17', 'C1 list: edgeband #20'),
    (c1, iaruna, 1, 23468, '2026-10-03', 'C1 list: hardware #2'),
    (c1, iaruna, 1, 1535, '2026-10-10', 'C1 list: hardware #3'),
    (c1, iaruna, 1, 600, '2026-10-20', 'C1 list: hardware #5'),
    (c1, iaruna, 1, 5070, '2026-10-20', 'C1 list: hardware #6'),
    (c1, iaruna, 1, 50, '2026-10-23', 'C1 list: hardware #7'),
    (c1, iaruna, 1, 7070, '2026-10-26', 'C1 list: hardware #8'),
    (c1, iaruna, 1, 2070, '2026-10-26', 'C1 list: hardware #9'),
    (c1, ibalaji, 1, 2815, '2026-10-31', 'C1 list: hardware #10'),
    (c1, iaruna, 1, 8168, '2026-11-11', 'C1 list: hardware #11');

  insert into public.design_build_expenses (expense_date, category_id, amount, description, design_project_id, source, notes) values
    ('2026-10-03', cat_fc, 50000, 'False ceiling (advance)', c1, 'manual', 'C1 list: hardwares #1'),
    ('2026-10-17', cat_fc, 45500, 'False ceiling', c1, 'manual', 'C1 list: hardwares #4'),
    ('2026-10-03', cat_lab, 8000, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-10-10', cat_lab, 22000, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-10-17', cat_lab, 16250, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-10-24', cat_lab, 28000, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-10-31', cat_lab, 37000, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-11-07', cat_lab, 13500, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-11-14', cat_lab, 18500, 'Labour - Arun', c1, 'manual', 'C1 list'),
    ('2026-10-03', cat_trn, 200, 'Factory to C1', c1, 'manual', 'C1 list: transport #1'),
    ('2026-10-10', cat_trn, 300, 'Factory to C1', c1, 'manual', 'C1 list: transport #2'),
    ('2026-10-13', cat_trn, 400, 'Factory to C1', c1, 'manual', 'C1 list: transport #3'),
    ('2026-10-16', cat_trn, 150, 'Factory to C1', c1, 'manual', 'C1 list: transport #4'),
    ('2026-10-18', cat_trn, 600, 'Factory to C1', c1, 'manual', 'C1 list: transport #5'),
    ('2026-10-23', cat_trn, 500, 'Factory to C1', c1, 'manual', 'C1 list: transport #6'),
    ('2026-10-31', cat_trn, 150, 'Factory to C1', c1, 'manual', 'C1 list: transport #7'),
    ('2026-11-04', cat_trn, 300, 'Factory to C1', c1, 'manual', 'C1 list: transport #8'),
    ('2026-11-05', cat_trn, 550, 'MSS Parcel', c1, 'manual', 'C1 list: transport #9'),
    ('2026-11-05', cat_trn, 250, 'Auto', c1, 'manual', 'C1 list: transport #10'),
    ('2026-11-02', cat_trn, 2225, 'MSS Parcel', c1, 'manual', 'C1 list: transport #11'),
    ('2026-11-09', cat_trn, 300, 'Auto', c1, 'manual', 'C1 list: transport #12'),
    ('2026-11-09', cat_trn, 400, 'Bit', c1, 'manual', 'C1 list: transport #13'),
    ('2026-11-11', cat_trn, 300, 'Auto', c1, 'manual', 'C1 list: transport #14'),
    ('2026-11-12', cat_trn, 600, 'Bit', c1, 'manual', 'C1 list: transport #15'),
    ('2026-11-13', cat_trn, 150, 'Flexkwik', c1, 'manual', 'C1 list: transport #16'),
    ('2026-11-14', cat_trn, 300, 'Auto', c1, 'manual', 'C1 list: transport #17'),
    ('2026-11-15', cat_trn, 3540, 'ST courier', c1, 'manual', 'C1 list: transport #18'),
    ('2026-11-15', cat_trn, 300, 'Auto', c1, 'manual', 'C1 list: transport #19'),
    ('2026-11-17', cat_trn, 300, 'Factory to C1', c1, 'manual', 'C1 list: transport #20');
end $$;
