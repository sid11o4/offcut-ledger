-- Each skin on a composite is pasted with fevicol: the per-skin cost is the Pasting rate plus the
-- FEVICOL rate, both the active Design Build Order rates in the job work catalogue. Read live, never
-- stored, so a rate change reaches every composite.
create or replace function public.composite_pasting_rate()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(latest.rate), 0)
  from (
    select distinct on (s.name) s.name, r.rate
    from public.rates r
    join public.job_work_services s on s.id = r.job_work_service_id
    join public.rate_categories rc on rc.id = r.rate_category_id
    where s.name in ('Pasting', 'FEVICOL') and rc.name = 'Design Build Order'
      and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
    order by s.name, r.effective_from desc
  ) latest;
$$;
