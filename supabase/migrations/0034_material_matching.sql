-- AI material-name correlation (business context, Oct 2026): "recognise different terms of
-- the same product entered between inventory and actual billing... always ask for confirmation
-- unless 95 percent sure." The actual correlation runs in the extract-supplier-bill-scan Edge
-- Function (Claude reads the line text against the known inventory_items list, the same way
-- extract-edgeband-scan already matches project/service names -- see 0026); this table is
-- where every suggestion it makes is recorded, auditable, and confirmed or rejected by a human
-- for anything under the 95% bar. A suggestion at or above 95% is auto-applied by the Edge
-- Function directly (inventory_item_id set, status 'confirmed') -- it still gets a row here so
-- the decision is visible and reversible, never silent.

create table public.material_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  supplier_bill_item_id uuid not null references public.supplier_bill_items(id) on delete cascade,
  suggested_inventory_item_id uuid not null references public.inventory_items(id),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  reasoning text, -- short note on why the AI thinks these are the same product
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz
);
create index idx_material_match_suggestions_item on public.material_match_suggestions(supplier_bill_item_id);

create or replace function public.confirm_material_match(p_suggestion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_suggestion record;
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  select * into v_suggestion from public.material_match_suggestions where id = p_suggestion_id;
  if v_suggestion.id is null then raise exception 'Suggestion not found.'; end if;

  update public.supplier_bill_items set inventory_item_id = v_suggestion.suggested_inventory_item_id
    where id = v_suggestion.supplier_bill_item_id;
  update public.material_match_suggestions
    set status = 'confirmed', decided_by = auth.uid(), decided_at = now()
    where id = p_suggestion_id;
end;
$$;

create or replace function public.reject_material_match(p_suggestion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'Your account is inactive.'; end if;
  update public.material_match_suggestions
    set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where id = p_suggestion_id;
end;
$$;

grant execute on function
  public.confirm_material_match(uuid),
  public.reject_material_match(uuid)
to authenticated;
