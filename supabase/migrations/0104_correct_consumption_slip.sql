-- Correct an old consumption slip. The slip's earlier stock movements are reversed (not deleted, so
-- the audit trail stays and reports follow the net), the slip is rewritten with the corrected date,
-- project, notes and lines, and the new lines are posted as fresh consumption.
create or replace function public.correct_consumption_slip(
  p_slip_id uuid, p_date date, p_design_project_id uuid, p_notes text, p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip public.inventory_slips;
  v_item record;
  v_line jsonb;
begin
  if not public.has_permission('inventory_operate') then
    raise exception 'You do not have permission to correct a slip.';
  end if;
  select * into v_slip from public.inventory_slips where id = p_slip_id for update;
  if v_slip.id is null then raise exception 'Slip not found.'; end if;
  if v_slip.slip_type <> 'consumption' then raise exception 'Only a consumption slip can be corrected here.'; end if;
  if p_design_project_id is null then raise exception 'Select the project this consumption is against.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A slip needs at least one line.';
  end if;

  for v_item in
    select i.inventory_txn_id from public.inventory_slip_items i
    join public.inventory_transactions t on t.id = i.inventory_txn_id
    where i.slip_id = p_slip_id and t.reversed_by is null
  loop
    perform public.reverse_inventory_transaction(v_item.inventory_txn_id, 'Slip ' || v_slip.slip_number || ' corrected');
  end loop;
  delete from public.inventory_slip_items where slip_id = p_slip_id;

  update public.inventory_slips
    set slip_date = coalesce(p_date, slip_date), design_project_id = p_design_project_id, notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_slip_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'quantity')::numeric, 0) <= 0 then raise exception 'Every line needs a quantity above zero.'; end if;
    insert into public.inventory_slip_items (slip_id, item_id, quantity)
      values (p_slip_id, (v_line->>'item_id')::uuid, (v_line->>'quantity')::numeric);
  end loop;

  perform public.post_inventory_slip(p_slip_id);
end;
$$;

revoke all on function public.correct_consumption_slip(uuid, date, uuid, text, jsonb) from public, anon;
grant execute on function public.correct_consumption_slip(uuid, date, uuid, text, jsonb) to authenticated;
