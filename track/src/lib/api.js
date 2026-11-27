import { supabase } from './supabase'
import { snapshotOf, weighted, itemPct, itemWeight } from './progress'

function must({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

const toCat = (c) => ({ id: c.id, name: c.name, weight: Number(c.weight), hasPolish: c.has_polish, tasks: c.tasks || [], isDefault: c.is_default })

export async function loadCategories() {
  const rows = must(await supabase.from('track_categories').select('*').order('sort_order').order('name'))
  return rows.map(toCat)
}

export async function loadProjects() {
  return must(await supabase.from('track_projects').select('*').order('created_at', { ascending: false }))
}

// Rooms and BOQ items for a project, each item carrying its category and progress array.
export async function loadPlan(projectId, categories) {
  const [rooms, items, prog] = await Promise.all([
    supabase.from('track_rooms').select('*').eq('project_id', projectId).order('sort_order').order('name'),
    supabase.from('track_boq_items').select('*').eq('project_id', projectId).order('sort_order').order('created_at'),
    supabase.from('track_boq_progress').select('boq_item_id, progress, track_boq_items!inner(project_id)').eq('track_boq_items.project_id', projectId),
  ])
  const progress = new Map(must(prog).map((p) => [p.boq_item_id, p.progress || []]))
  const byId = new Map(categories.map((c) => [c.id, c]))
  return {
    rooms: must(rooms),
    items: must(items).map((i) => ({
      id: i.id, roomId: i.room_id, title: i.title, sqft: Number(i.sqft), polish: i.polish,
      categoryId: i.category_id, cat: byId.get(i.category_id), progress: progress.get(i.id) || [],
    })),
  }
}

export function summarise(plan) {
  const rows = plan.items.map((i) => ({ roomId: i.roomId, pct: itemPct(i.cat, i.polish, i.progress), weight: itemWeight(i.cat, i.sqft) }))
  return {
    overall: weighted(rows),
    rooms: plan.rooms.map((r) => ({ ...r, pct: weighted(rows.filter((x) => x.roomId === r.id)), items: plan.items.filter((i) => i.roomId === r.id).length })),
  }
}

export async function saveProgress(itemId, progress) {
  must(await supabase.from('track_boq_progress').update({ progress, updated_at: new Date().toISOString() }).eq('boq_item_id', itemId))
}

// --- structure (admin) ---
export const addProject = async (p) => must(await supabase.from('track_projects').insert(p).select().single())
export const updateProject = async (id, p) => must(await supabase.from('track_projects').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id))
export const addRoom = async (projectId, name, sort) => must(await supabase.from('track_rooms').insert({ project_id: projectId, name, sort_order: sort }).select().single())
export const renameRoom = async (id, name) => must(await supabase.from('track_rooms').update({ name }).eq('id', id))
export const deleteRoom = async (id) => must(await supabase.from('track_rooms').delete().eq('id', id))
export const addItem = async (i) => must(await supabase.from('track_boq_items').insert(i).select().single())
export const updateItem = async (id, i) => must(await supabase.from('track_boq_items').update({ ...i, updated_at: new Date().toISOString() }).eq('id', id))
export const deleteItem = async (id) => must(await supabase.from('track_boq_items').delete().eq('id', id))
export const saveCategory = async (c) => {
  const row = { name: c.name, weight: c.weight, has_polish: c.hasPolish, tasks: c.tasks }
  return c.id
    ? must(await supabase.from('track_categories').update(row).eq('id', c.id))
    : must(await supabase.from('track_categories').insert(row))
}
export const deleteCategory = async (id) => must(await supabase.from('track_categories').delete().eq('id', id))

// --- daily reports ---
export async function getReport(projectId, date) {
  return must(await supabase.from('track_daily_reports').select('*').eq('project_id', projectId).eq('report_date', date).maybeSingle())
}
export async function listReports(projectId) {
  return must(await supabase.from('track_daily_reports').select('*').eq('project_id', projectId).order('report_date', { ascending: false }).limit(60))
}
export async function startDay(projectId, date, plan, uid) {
  const s = summarise(plan)
  return must(await supabase.from('track_daily_reports').insert({
    project_id: projectId, report_date: date, start_state: snapshotOf(plan.items), start_pct: s.overall, started_by: uid,
  }).select().single())
}
export async function saveDetails(id, d) {
  must(await supabase.from('track_daily_reports').update({ ...d, updated_at: new Date().toISOString() }).eq('id', id))
}
export async function closeDay(id, plan, uid) {
  const s = summarise(plan)
  must(await supabase.from('track_daily_reports').update({
    end_state: snapshotOf(plan.items), end_pct: s.overall, closed_by: uid, closed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id))
}
export async function reopenDay(id) {
  must(await supabase.from('track_daily_reports').update({ closed_at: null, closed_by: null, end_state: null, end_pct: null }).eq('id', id))
}

// --- photos (private bucket, signed urls) ---
export async function listPhotos(projectId, date) {
  const rows = must(await supabase.from('track_photos').select('*').eq('project_id', projectId).eq('report_date', date).order('created_at'))
  if (!rows.length) return []
  const { data } = await supabase.storage.from('track-photos').createSignedUrls(rows.map((r) => r.storage_path), 3600)
  const urls = new Map((data || []).map((d) => [d.path, d.signedUrl]))
  return rows.map((r) => ({ ...r, url: urls.get(r.storage_path) }))
}
export async function uploadPhoto(projectId, date, file, uid, caption = null) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${projectId}/${date}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('track-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
  if (up.error) throw new Error(up.error.message)
  must(await supabase.from('track_photos').insert({ project_id: projectId, report_date: date, storage_path: path, caption: caption || null, created_by: uid }))
}
export async function deletePhoto(photo) {
  await supabase.storage.from('track-photos').remove([photo.storage_path])
  must(await supabase.from('track_photos').delete().eq('id', photo.id))
}

// --- material requests ---
export async function inventoryCatalog(projectId) {
  return must(await supabase.rpc('track_inventory_catalog', { p_track_project: projectId }))
}
export async function listRequests(projectId) {
  return must(await supabase.from('track_material_requests')
    .select('*, items:track_material_request_items(id, item_id, free_text_name, quantity, unit_text, inventory_items(name))')
    .eq('project_id', projectId).order('created_at', { ascending: false }))
}
export async function createRequest(projectId, uid, head, lines) {
  const req = must(await supabase.from('track_material_requests').insert({ project_id: projectId, requested_by: uid, ...head }).select().single())
  const { error } = await supabase.from('track_material_request_items').insert(lines.map((l) => ({
    request_id: req.id, item_id: l.itemId || null, free_text_name: l.itemId ? null : l.name, quantity: l.quantity, unit_text: l.unit || null,
  })))
  if (error) {
    await supabase.from('track_material_requests').update({ status: 'cancelled', response_note: 'Could not save its lines' }).eq('id', req.id)
    throw new Error(error.message)
  }
  return req
}
export async function setRequestStatus(id, status, responseNote, uid, admin) {
  const patch = { status, response_note: responseNote || null }
  if (admin) { patch.decided_by = uid; patch.decided_at = new Date().toISOString() }
  must(await supabase.from('track_material_requests').update(patch).eq('id', id))
}

// --- members ---
export async function listMembers() {
  return must(await supabase.from('track_members').select('*').order('created_at'))
}
export const setMember = async (email, role) => must(await supabase.rpc('track_set_member', { p_email: email, p_role: role }))
export const removeMember = async (userId) => must(await supabase.rpc('track_remove_member', { p_user: userId }))
