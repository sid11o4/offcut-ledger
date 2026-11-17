-- Hardware is its own Materials sub-group in every Design Build cost report, next to Raw Board, Edgeband,
-- Skin, Adhesives and Others.
create or replace function public.design_cost_group_of_head(p_head text, p_item_type text)
returns text[]
language sql
immutable
as $$
  select case p_head
    when 'raw_boards' then array['Materials', 'Raw Board']
    when 'edgeband' then array['Materials', 'Edgeband']
    when 'skins' then array['Materials', 'Skin']
    when 'adhesives' then array['Materials', 'Adhesives']
    when 'hardware' then array['Materials', 'Hardware']
    when 'other' then array['Materials', 'Others']
    when 'factory_labour' then array['Labour', null]
    when 'site_labour' then array['Labour', null]
    when 'employee_salary' then array['Labour', null]
    when 'transport' then array['Transport', null]
    when 'miscellaneous' then array['Miscellaneous', null]
    else case when p_item_type = 'labour' then array['Labour', null] else array['Materials', 'Others'] end
  end;
$$;

create or replace function public.design_cost_sub_of_item(p_category text, p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_category = 'Raw Boards' then 'Raw Board'
    when p_category = 'Skins' then 'Skin'
    when p_category = 'Edgeband' then 'Edgeband'
    when p_category = 'Hardware' then 'Hardware'
    when p_name ~* '(fevicol|adhesive|glue|gum)' then 'Adhesives'
    else 'Others'
  end;
$$;
