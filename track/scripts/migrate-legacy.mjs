// One-off: copy the old Interior Project Tracker data (Supabase project eqykmjxbjkspacrajqim) into
// the track_* tables of the factory database. Safe to re-run: projects are matched by name, and
// existing rooms / items / reports are left alone. Needs service-role keys, so run it locally:
//
//   LEGACY_URL=https://eqykmjxbjkspacrajqim.supabase.co LEGACY_KEY=<service role> \
//   NEW_URL=https://hawypgqheoddtoiefwls.supabase.co    NEW_KEY=<service role> \
//   node scripts/migrate-legacy.mjs [--dry-run]
//
// Not carried over: day-start/end snapshots (their JSON shape is the old app's). Migrated reports
// keep date, plan, issues, materials, labour and photos; their start/end percentages show 0.
import { createClient } from '@supabase/supabase-js'

const { LEGACY_URL, LEGACY_KEY, NEW_URL, NEW_KEY } = process.env
if (!LEGACY_URL || !LEGACY_KEY || !NEW_URL || !NEW_KEY) { console.error('Set LEGACY_URL, LEGACY_KEY, NEW_URL, NEW_KEY'); process.exit(1) }
const dry = process.argv.includes('--dry-run')
const old = createClient(LEGACY_URL, LEGACY_KEY, { auth: { persistSession: false } })
const neu = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } })
const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data }
const log = (...a) => console.log(dry ? '[dry]' : '', ...a)

const cats = ok(await neu.from('track_categories').select('*'), 'categories')
const catByName = new Map(cats.map((c) => [c.name, c]))
for (const c of ok(await old.from('custom_categories').select('*'), 'legacy categories')) {
  const mapped = { name: c.name, weight: c.weight, has_polish: c.has_polish, tasks: c.tasks, is_default: c.is_default }
  if (catByName.has(c.name)) { if (!dry) ok(await neu.from('track_categories').update({ weight: c.weight, has_polish: c.has_polish, tasks: c.tasks }).eq('name', c.name), 'update category'); log('category updated', c.name) }
  else { if (!dry) catByName.set(c.name, ok(await neu.from('track_categories').insert(mapped).select().single(), 'insert category')); else catByName.set(c.name, { id: 'dry' }); log('category added', c.name) }
}

for (const p of ok(await old.from('projects').select('*'), 'legacy projects')) {
  let proj = ok(await neu.from('track_projects').select('*').eq('name', p.name).maybeSingle(), 'find project')
  if (!proj) { if (!dry) proj = ok(await neu.from('track_projects').insert({ name: p.name, created_at: p.created_at }).select().single(), 'insert project'); log('project', p.name) }
  if (!proj) continue

  const roomId = new Map(ok(await neu.from('track_rooms').select('id, name').eq('project_id', proj.id), 'rooms').map((r) => [r.name, r.id]))
  for (const r of ok(await old.from('rooms').select('*').eq('project_id', p.id).order('sort_order'), 'legacy rooms')) {
    if (roomId.has(r.name)) continue
    roomId.set(r.name, ok(await neu.from('track_rooms').insert({ project_id: proj.id, name: r.name, sort_order: r.sort_order }).select().single(), 'room').id)
  }

  if (!ok(await neu.from('track_boq_items').select('id').eq('project_id', proj.id).limit(1), 'items check').length) {
    const items = ok(await old.from('boq_items').select('*, boq_item_progress(progress)').eq('project_id', p.id).order('sort_order'), 'legacy items')
    for (const i of items) {
      const cat = catByName.get(i.cat)
      if (!cat) { console.warn('skipping item with unknown category', i.title, i.cat); continue }
      let rid = roomId.get(i.room)
      if (!rid && i.room && !dry) { rid = ok(await neu.from('track_rooms').insert({ project_id: proj.id, name: i.room }).select().single(), 'room').id; roomId.set(i.room, rid) }
      if (!rid || dry) { log('item', i.title); continue }
      const row = ok(await neu.from('track_boq_items').insert({ project_id: proj.id, room_id: rid, category_id: cat.id, title: i.title, sqft: i.sqft, polish: i.polish, sort_order: i.sort_order }).select().single(), 'item')
      const prog = Array.isArray(i.boq_item_progress) ? i.boq_item_progress[0]?.progress : i.boq_item_progress?.progress
      if (prog?.length) ok(await neu.from('track_boq_progress').update({ progress: prog }).eq('boq_item_id', row.id), 'progress')
    }
  }

  const have = new Set(ok(await neu.from('track_daily_reports').select('report_date').eq('project_id', proj.id), 'reports').map((r) => r.report_date))
  for (const d of ok(await old.from('daily_progress_details').select('*').eq('project_id', p.id), 'legacy details')) {
    if (have.has(d.report_date)) continue
    log('report', p.name, d.report_date)
    if (!dry) ok(await neu.from('track_daily_reports').insert({ project_id: proj.id, report_date: d.report_date, next_day_plan: d.next_day_plan, issues: d.issues, materials: d.materials, labour: d.labour_breakdown, closed_at: new Date().toISOString() }), 'report')
  }

  for (const ph of ok(await old.from('dpr_photos').select('*').eq('project_id', p.id), 'legacy photos')) {
    const path = `${proj.id}/${ph.report_date}/${ph.storage_path.split('/').pop()}`
    if (dry) { log('photo', path); continue }
    const dl = await old.storage.from('dpr-photos').download(ph.storage_path)
    if (dl.error) { console.warn('photo skipped', ph.storage_path, dl.error.message); continue }
    const up = await neu.storage.from('track-photos').upload(path, dl.data, { upsert: true, contentType: dl.data.type || 'image/jpeg' })
    if (up.error) { console.warn('photo upload failed', path, up.error.message); continue }
    const dup = ok(await neu.from('track_photos').select('id').eq('storage_path', path), 'photo dup')
    if (!dup.length) ok(await neu.from('track_photos').insert({ project_id: proj.id, report_date: ph.report_date, storage_path: path }), 'photo row')
  }
}
log('done')
