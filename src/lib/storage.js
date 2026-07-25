import { supabase } from './supabaseClient';

function must(res) {
  if (res.error) throw res.error;
  return res.data;
}

/* ---------------- Inventory ---------------- */
export async function fetchInventory() {
  const res = await supabase.from('offcut_inventory').select('*').order('material').order('length');
  return must(res).map((r) => ({ id: r.id, material: r.material, length: Number(r.length), width: Number(r.width), bin: r.bin, qty: Number(r.qty) }));
}

export async function insertInventoryRow({ material, length, width, bin, qty }) {
  const res = await supabase.from('offcut_inventory').insert({ material, length, width, bin, qty }).select().single();
  const r = must(res);
  return { id: r.id, material: r.material, length: Number(r.length), width: Number(r.width), bin: r.bin, qty: Number(r.qty) };
}

export async function updateInventoryQty(id, qty) {
  must(await supabase.from('offcut_inventory').update({ qty }).eq('id', id));
}

export async function deleteInventoryRow(id) {
  must(await supabase.from('offcut_inventory').delete().eq('id', id));
}

export async function clearInventory() {
  must(await supabase.from('offcut_inventory').delete().not('id', 'is', null));
}

// Wipes and replaces the whole inventory table in one go — used when "Apply to inventory"
// commits a matching run's pendingInventory as the new live stock.
export async function replaceInventory(rows) {
  await clearInventory();
  if (!rows.length) return [];
  const res = await supabase.from('offcut_inventory').insert(
    rows.map((o) => ({ material: o.material, length: o.length, width: o.width, bin: o.bin, qty: o.qty }))
  ).select();
  return must(res).map((r) => ({ id: r.id, material: r.material, length: Number(r.length), width: Number(r.width), bin: r.bin, qty: Number(r.qty) }));
}

/* ---------------- Unexposed materials ---------------- */
export async function fetchUnexposedMaterials() {
  const res = await supabase.from('offcut_unexposed_materials').select('*').order('created_at');
  return must(res).map((r) => ({ id: r.id, material: r.material, thicknesses: r.thicknesses.map(Number) }));
}

export async function insertUnexposedMaterial({ material, thicknesses }) {
  const res = await supabase.from('offcut_unexposed_materials').insert({ material, thicknesses }).select().single();
  const r = must(res);
  return { id: r.id, material: r.material, thicknesses: r.thicknesses.map(Number) };
}

export async function deleteUnexposedMaterial(id) {
  must(await supabase.from('offcut_unexposed_materials').delete().eq('id', id));
}

/* ---------------- Discard rules ---------------- */
export async function fetchDiscardRules() {
  const res = await supabase.from('offcut_discard_rules').select('*').order('created_at');
  return must(res).map((r) => ({ id: r.id, material: r.material, minLength: Number(r.min_length), minWidth: Number(r.min_width) }));
}

export async function insertDiscardRule({ material, minLength, minWidth }) {
  const res = await supabase.from('offcut_discard_rules').insert({ material, min_length: minLength, min_width: minWidth }).select().single();
  const r = must(res);
  return { id: r.id, material: r.material, minLength: Number(r.min_length), minWidth: Number(r.min_width) };
}

export async function deleteDiscardRule(id) {
  must(await supabase.from('offcut_discard_rules').delete().eq('id', id));
}

/* ---------------- Projects ---------------- */
function projectFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    savedAt: Number(r.saved_at),
    cutlistFileName: r.cutlist_file_name,
    cutlistFields: r.cutlist_fields || [],
    cutlistRows: r.cutlist_rows || [],
    kerf: Number(r.kerf),
    matched: r.matched || [],
    remaining: r.remaining || [],
    applied: r.applied,
    newRemnants: r.new_remnants || [],
    discardedOffcuts: r.discarded_offcuts || [],
    originTrimRects: r.origin_trim_rects || [],
  };
}

export async function fetchProjects() {
  const res = await supabase.from('offcut_projects').select('*').order('saved_at', { ascending: false });
  return must(res).map(projectFromRow);
}

export async function insertProject(project) {
  const res = await supabase.from('offcut_projects').insert({
    name: project.name,
    saved_at: project.savedAt,
    cutlist_file_name: project.cutlistFileName,
    cutlist_fields: project.cutlistFields,
    cutlist_rows: project.cutlistRows,
    kerf: project.kerf,
    matched: project.matched,
    remaining: project.remaining,
    applied: project.applied,
    new_remnants: project.newRemnants,
    discarded_offcuts: project.discardedOffcuts,
    origin_trim_rects: project.originTrimRects,
  }).select().single();
  return projectFromRow(must(res));
}

export async function deleteProject(id) {
  must(await supabase.from('offcut_projects').delete().eq('id', id));
}
