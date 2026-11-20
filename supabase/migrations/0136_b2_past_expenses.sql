-- B2's own list: costs incurred before the system held stock. Nothing is taken from inventory.
-- B2's raw boards and mica were loaded earlier; this adds what that load did not have.
do $$
declare
  b2 uuid := 'b4cc1629-0396-4964-8642-46a49027a02c';
  rm uuid := (select id from public.units where code = 'RM' and active);
  nos uuid := (select id from public.units where code = 'NOS' and active);
  cat_lab uuid := (select id from public.expense_categories where name = 'Labour');
  cat_trn uuid := (select id from public.expense_categories where name = 'Transport');
  cat_fc uuid := (select id from public.expense_categories where name = 'False Ceiling');
  i3088 uuid; i75729 uuid; iven uuid; i2102 uuid; iaruna uuid; ifev uuid;
  ic uuid; ir20 uuid; ir16 uuid; ir12 uuid; ir18 uuid; itb uuid; ipvc uuid;
begin
  if exists (select 1 from public.past_material_consumption p join public.inventory_items i on i.id = p.item_id
             where p.design_project_id = b2 and i.category = 'Edgeband' and not p.voided) then
    raise exception 'B2 already has past edgeband entries';
  end if;

  select id into i3088 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('3088 0.8') and active limit 1;
  if i3088 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('3088 0.8', rm, true, 'Edgeband') returning id into i3088; end if;
  select id into i75729 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('75729') and active limit 1;
  if i75729 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('75729', rm, true, 'Edgeband') returning id into i75729; end if;
  select id into iven from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('Veneer') and active limit 1;
  if iven is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Veneer', rm, true, 'Edgeband') returning id into iven; end if;
  select id into i2102 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('2102 2mm') and active limit 1;
  if i2102 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('2102 2mm', rm, true, 'Edgeband') returning id into i2102; end if;

  select id into iaruna from public.inventory_items where name = 'Hardware - Aruna Plywood' limit 1;
  if iaruna is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Hardware - Aruna Plywood', nos, false, 'Hardware') returning id into iaruna; end if;
  select id into ifev from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('Fevicol Hi-per 50kg') and active limit 1;
  if ifev is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Fevicol Hi-per 50kg', nos, false, 'Others') returning id into ifev; end if;

  -- Splendour Solutions hardware, itemised (all paid)
  select id into ic from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('0 Crank') and active limit 1;
  if ic is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('0 Crank', nos, false, 'Hardware') returning id into ic; end if;
  select id into ir20 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('20" Runner') and active limit 1;
  if ir20 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('20" Runner', nos, false, 'Hardware') returning id into ir20; end if;
  select id into ir16 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('16" Runner') and active limit 1;
  if ir16 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('16" Runner', nos, false, 'Hardware') returning id into ir16; end if;
  select id into ir12 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('12" Runner') and active limit 1;
  if ir12 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('12" Runner', nos, false, 'Hardware') returning id into ir12; end if;
  select id into ir18 from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('18" Runner') and active limit 1;
  if ir18 is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('18" Runner', nos, false, 'Hardware') returning id into ir18; end if;
  select id into itb from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('Tandem Box') and active limit 1;
  if itb is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('Tandem Box', nos, false, 'Hardware') returning id into itb; end if;
  select id into ipvc from public.inventory_items where public.inventory_name_key(name) = public.inventory_name_key('PVC Leg') and active limit 1;
  if ipvc is null then insert into public.inventory_items (name, unit_id, track_as_inventory, category) values ('PVC Leg', nos, false, 'Hardware') returning id into ipvc; end if;

  insert into public.past_material_consumption (design_project_id, item_id, quantity, unit_cost, consumed_on, note) values
    (b2, ifev, 1, 17170, '2026-11-20', 'B2 list: materials #10'),
    (b2, i3088, 339.03, 17, '2026-11-20', 'B2 list: edgeband #15'),
    (b2, i3088, 50.66, 17, '2026-11-20', 'B2 list: edgeband #16'),
    (b2, i75729, 91.1, 90, '2026-11-20', 'B2 list: edgeband #17'),
    (b2, iven, 8.9, 69, '2026-11-20', 'B2 list: edgeband #18'),
    (b2, i3088, 4.6, 17, '2026-11-20', 'B2 list: edgeband #19'),
    (b2, i3088, 83.49, 17, '2026-11-20', 'B2 list: edgeband #20'),
    (b2, i75729, 3, 90, '2026-11-20', 'B2 list: edgeband #21'),
    (b2, i2102, 50, 48, '2026-11-20', 'B2 list: edgeband #22'),
    (b2, i3088, 75, 17, '2026-11-20', 'B2 list: edgeband #23'),
    (b2, i3088, 10.66, 17, '2026-11-20', 'B2 list: edgeband #24'),
    (b2, iaruna, 1, 2587, '2026-04-30', 'B2 list: hardware #1'),
    (b2, iaruna, 1, 19214, '2026-08-13', 'B2 list: hardware #3 (corrected from 26152)'),
    (b2, iaruna, 1, 658, '2026-09-26', 'B2 list: hardware #4'),
    (b2, iaruna, 1, 2466, '2026-10-10', 'B2 list: hardware #7'),
    (b2, ic, 80, 200, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, ir20, 10, 729, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, ir16, 4, 670, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, ir12, 3, 610, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, ir18, 6, 697, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, itb, 4, 5935, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)'),
    (b2, ipvc, 100, 30, '2026-08-18', 'B2 list: Splendour Solutions hardware (paid)');

  insert into public.design_build_expenses (expense_date, category_id, amount, description, design_project_id, source, notes) values
    ('2026-10-10', cat_fc, 70000, 'False ceiling (advance)', b2, 'manual', 'B2 list: hardwares #5'),
    ('2026-10-17', cat_fc, 16000, 'False ceiling', b2, 'manual', 'B2 list: hardwares #6'),
    ('2026-08-15', cat_lab, 15000, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-08-22', cat_lab, 28500, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-09-12', cat_lab, 2000, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-09-19', cat_lab, 10000, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-09-26', cat_lab, 35500, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-10-03', cat_lab, 34750, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-10-10', cat_lab, 14500, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-10-31', cat_lab, 5000, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-10-14', cat_lab, 2250, 'Labour - Arun', b2, 'manual', 'B2 list'),
    ('2026-08-29', cat_trn, 330, 'Hardwares Parcel', b2, 'manual', 'B2 list: transport #1'),
    ('2026-08-14', cat_trn, 300, 'Factory to B2', b2, 'manual', 'B2 list: transport #2'),
    ('2026-09-15', cat_trn, 300, 'Factory to B2', b2, 'manual', 'B2 list: transport #3'),
    ('2026-09-28', cat_trn, 520, 'Wheel', b2, 'manual', 'B2 list: transport #4'),
    ('2026-09-30', cat_trn, 200, 'Factory to B2', b2, 'manual', 'B2 list: transport #5'),
    ('2026-10-10', cat_trn, 400, 'Auto', b2, 'manual', 'B2 list: transport #6'),
    ('2026-10-31', cat_trn, 150, 'Factory to B2', b2, 'manual', 'B2 list: transport #7'),
    ('2026-11-13', cat_trn, 300, 'Factory to B2', b2, 'manual', 'B2 list: transport #8');
end $$;
