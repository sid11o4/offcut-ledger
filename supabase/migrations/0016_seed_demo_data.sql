-- Sample/demo data (spec section 59). Everything below is clearly fictional and exists to
-- demonstrate the app end-to-end (rate history, daily log, estimate vs actual, partial
-- billing, recurring expenses). All demo client/project codes are prefixed DEMO- so they are
-- easy to identify and remove later. Rates below are illustrative sample numbers, not real
-- factory pricing (spec section 58).

-- Two more real (non-demo) expense categories the recurring-expense examples in the spec need.
insert into public.expense_categories (code, name) values
  ('RENT', 'Rent'),
  ('EMI', 'Loan / EMI Payments'),
  ('SALARY', 'Fixed Salaries');

insert into public.clients (code, name, contact_person, phone, email, default_rate_category_id, notes)
select 'DEMO-C1', 'Sunrise Interiors', 'Rahul Mehta', '9800000001', 'rahul@sunriseinteriors.example',
       rc.id, 'Sample client for demonstration.'
from public.rate_categories rc where rc.code = 'REGULAR';

insert into public.clients (code, name, contact_person, phone, email, default_rate_category_id, notes)
select 'DEMO-C2', 'Metro Modular Kitchens', 'Anita Rao', '9800000002', 'anita@metromodular.example',
       rc.id, 'Sample client for demonstration.'
from public.rate_categories rc where rc.code = 'ONEOFF';

insert into public.clients (code, name, contact_person, phone, email, default_rate_category_id, notes)
select 'DEMO-C3', 'Formgrid Factory (Internal)', null, null, null,
       rc.id, 'Placeholder client for internal/own-stock job work.'
from public.rate_categories rc where rc.code = 'INTERNAL';

insert into public.projects (code, name, client_id, rate_category_id, start_date, status, notes)
select 'DEMO-P1', 'Sunrise - Wardrobe Batch 1', c.id, c.default_rate_category_id, '2026-08-15', 'active', 'Sample project for demonstration.'
from public.clients c where c.code = 'DEMO-C1';

insert into public.projects (code, name, client_id, rate_category_id, start_date, status, notes)
select 'DEMO-P2', 'Metro - Kitchen Shutters', c.id, c.default_rate_category_id, '2026-08-20', 'active', 'Sample project for demonstration.'
from public.clients c where c.code = 'DEMO-C2';

insert into public.projects (code, name, client_id, rate_category_id, start_date, status, notes)
select 'DEMO-P3', 'Internal - Showroom Samples', c.id, c.default_rate_category_id, '2026-08-25', 'active', 'Sample project for demonstration.'
from public.clients c where c.code = 'DEMO-C3';

-- Sample rates. Cutting/REGULAR deliberately has two versions to demonstrate effective-dated
-- rate history exactly like the spec's own example (5.00 until 30-09, 5.50 from 01-10) --
-- here 4.75 until 31-08-2026, 5.50 from 01-09-2026, so demo entries on either side of that
-- date visibly use different rates.
insert into public.rates (job_work_service_id, rate_category_id, rate, effective_from, notes)
select s.id, rc.id, 4.75, '2026-01-01', 'Sample rate.'
from public.job_work_services s, public.rate_categories rc where s.code = 'CUTTING' and rc.code = 'REGULAR';
insert into public.rates (job_work_service_id, rate_category_id, rate, effective_from, notes)
select s.id, rc.id, 5.50, '2026-09-01', 'Sample rate revision.'
from public.job_work_services s, public.rate_categories rc where s.code = 'CUTTING' and rc.code = 'REGULAR';

insert into public.rates (job_work_service_id, rate_category_id, rate, effective_from, notes)
select s.id, rc.id, v.rate, '2026-01-01', 'Sample rate.'
from public.job_work_services s
join public.rate_categories rc on true
join (values
  ('CUTTING','INTERNAL',4.00), ('CUTTING','ONEOFF',6.00),
  ('PASTING','INTERNAL',3.00), ('PASTING','REGULAR',4.00), ('PASTING','ONEOFF',5.00),
  ('EDGE_08','INTERNAL',6.00), ('EDGE_08','REGULAR',8.00), ('EDGE_08','ONEOFF',10.00),
  ('EDGE_13','INTERNAL',9.00), ('EDGE_13','REGULAR',12.00), ('EDGE_13','ONEOFF',15.00)
) as v(service_code, category_code, rate) on v.service_code = s.code and v.category_code = rc.code;

insert into public.recurring_expenses (name, category_id, amount, frequency, start_date, due_day, notes)
select 'Factory Rent', ec.id, 45000, 'monthly', '2026-01-01', 5, 'Sample recurring expense.'
from public.expense_categories ec where ec.code = 'RENT';
insert into public.recurring_expenses (name, category_id, amount, frequency, start_date, due_day, notes)
select 'Equipment EMI', ec.id, 18500, 'monthly', '2026-01-01', 10, 'Sample recurring expense.'
from public.expense_categories ec where ec.code = 'EMI';
insert into public.recurring_expenses (name, category_id, amount, frequency, start_date, due_day, notes)
select 'Fixed Salaries', ec.id, 120000, 'monthly', '2026-01-01', 1, 'Sample recurring expense.'
from public.expense_categories ec where ec.code = 'SALARY';

-- Demo job-work entries, created through the real record_job_work_entry() RPC (not hand-built
-- INSERTs) so this seed also exercises the calculation engine exactly as the app will. This
-- runs as the seeded admin user by setting the request JWT claim Supabase's auth.uid() reads.
do $$
declare
  v_admin_id uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_ss_cut uuid; v_ds_cut uuid; v_double_paste uuid; v_cutting uuid; v_edge08 uuid; v_edge13 uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_estimate_id uuid;
begin
  select id into v_admin_id from public.profiles order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

  select id into v_p1 from public.projects where code = 'DEMO-P1';
  select id into v_p2 from public.projects where code = 'DEMO-P2';
  select id into v_p3 from public.projects where code = 'DEMO-P3';
  select id into v_ss_cut from public.job_work_services where code = 'SS_CUT';
  select id into v_ds_cut from public.job_work_services where code = 'DS_CUT';
  select id into v_double_paste from public.job_work_services where code = 'DOUBLE_PASTE';
  select id into v_cutting from public.job_work_services where code = 'CUTTING';
  select id into v_edge08 from public.job_work_services where code = 'EDGE_08';
  select id into v_edge13 from public.job_work_services where code = 'EDGE_13';

  v_e1 := public.record_job_work_entry('2026-08-28', v_p1, v_ss_cut, 500, 'Sample entry.');
  v_e2 := public.record_job_work_entry('2026-08-30', v_p1, v_ds_cut, 300, 'Sample entry.');
  -- Same service (Double Side Cutting) as v_e2, dated after the Cutting/REGULAR rate revision
  -- (01-Sep) took effect: this entry's Cutting component prices at 5.50, not 4.75 -- a live
  -- demonstration of rate history (spec section 10) rather than a hand-picked example.
  perform public.record_job_work_entry('2026-09-02', v_p1, v_ds_cut, 200, 'Sample entry (after rate revision).');
  perform public.record_job_work_entry('2026-09-05', v_p1, v_edge08, 200, 'Sample entry.');
  perform public.record_job_work_entry('2026-08-29', v_p2, v_double_paste, 400, 'Sample entry.');
  perform public.record_job_work_entry('2026-09-01', v_p2, v_ss_cut, 250, 'Sample entry.');
  perform public.record_job_work_entry('2026-08-31', v_p3, v_cutting, 150, 'Sample entry.');
  perform public.record_job_work_entry('2026-09-03', v_p3, v_edge13, 100, 'Sample entry.');

  -- Partial billing demo: bill only the first two Sunrise entries; the later entries are left
  -- unbilled so the project dashboard visibly shows both billed and unbilled work.
  perform public.generate_bill(v_p1, array[v_e1, v_e2], '2026-08-15', '2026-08-31', 0, 0, null, 'Sample bill covering August work.');

  -- Estimate vs actual demo: an estimate for Sunrise that runs ahead of the logged actuals.
  insert into public.estimates (client_id, project_id, rate_category_id, status, validity_date, tax_percent, notes)
  select c.id, v_p1, p.rate_category_id, 'issued', '2026-10-31', 0, 'Sample estimate for demonstration.'
  from public.projects p join public.clients c on c.id = p.client_id
  where p.id = v_p1
  returning id into v_estimate_id;

  -- Note: get_effective_rate() only prices ATOMIC services (rates live on those, not on
  -- composites like Single Side Cutting -- see 0006/0012), so the estimate line below uses
  -- Edgebanding 0.8mm, which is atomic and already has actual work logged against it on this
  -- project, making the estimate-vs-actual comparison meaningful.
  insert into public.estimate_items (estimate_id, service_id, quantity, unit_id, rate, amount, sort_order)
  select v_estimate_id, v_edge08, 2000, s.unit_id, r.rate_value, 2000 * r.rate_value, 1
  from public.job_work_services s, public.get_effective_rate(v_edge08, (select rate_category_id from public.projects where id = v_p1), '2026-08-15') r
  where s.id = v_edge08 and r.rate_value is not null;
end;
$$;
