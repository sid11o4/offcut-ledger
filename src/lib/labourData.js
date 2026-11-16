import { supabase } from './supabaseClient'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// The Monday that starts the week a date falls in.
export function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

// A key that groups a date as a day, a week (from its Monday) or a month.
export function periodKey(dateStr, groupBy) {
  if (groupBy === 'week') return weekStart(dateStr)
  if (groupBy === 'month') return dateStr.slice(0, 7)
  return dateStr
}

export function periodLabel(key, groupBy) {
  if (groupBy === 'month') {
    const [y, m] = key.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })
  }
  if (groupBy === 'week') return `Week of ${key}`
  return key
}

// The date range for a preset: today, this week, this month, or all time (empty bounds).
export function presetBounds(preset) {
  const t = new Date()
  const todayIso = iso(t)
  if (preset === 'today') return [todayIso, todayIso]
  if (preset === 'week') return [weekStart(todayIso), todayIso]
  if (preset === 'month') return [`${todayIso.slice(0, 7)}-01`, todayIso]
  return ['', '']
}

export function projectNameOf(entry) {
  if (entry.side === 'factory') return entry.projects?.name || 'Factory-wide'
  return entry.design_projects?.name || 'Design Build company'
}

// Every contractor with their all-time totals, for the list.
export async function listContractors() {
  const [cR, eR] = await Promise.all([
    supabase.from('labour_contractors').select('*').order('name'),
    supabase.from('labour_entries').select('contractor_id, shifts, amount, entry_date').eq('status', 'active'),
  ])
  if (cR.error) throw cR.error
  if (eR.error) throw eR.error
  const agg = new Map()
  for (const e of eR.data || []) {
    const a = agg.get(e.contractor_id) || { shifts: 0, amount: 0, last: null }
    a.shifts += Number(e.shifts)
    a.amount += Number(e.amount)
    if (!a.last || e.entry_date > a.last) a.last = e.entry_date
    agg.set(e.contractor_id, a)
  }
  return (cR.data || []).map((c) => ({ ...c, shifts: 0, amount: 0, last: null, ...(agg.get(c.id) || {}) }))
}

// One contractor with every labour entry, voided ones included, newest first.
export async function loadContractor(id) {
  const [cR, eR] = await Promise.all([
    supabase.from('labour_contractors').select('*').eq('id', id).single(),
    supabase.from('labour_entries')
      .select('*, projects(name, code), design_projects(name, code)')
      .eq('contractor_id', id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ])
  if (cR.error) throw cR.error
  if (eR.error) throw eR.error
  return { contractor: cR.data, entries: eR.data || [] }
}

// Totals for a date range (empty bounds mean all time), grouped by project and by period.
export function summarize(entries, { start = '', end = '', groupBy = 'month' } = {}) {
  const inRange = entries.filter((e) => (!start || e.entry_date >= start) && (!end || e.entry_date <= end))
  const active = inRange.filter((e) => e.status === 'active')
  const total = active.reduce((s, e) => s + Number(e.amount), 0)
  const shifts = active.reduce((s, e) => s + Number(e.shifts), 0)
  const days = new Set(active.map((e) => e.entry_date))
  const projects = new Map()
  const periods = new Map()
  for (const e of active) {
    const name = projectNameOf(e)
    const p = projects.get(name) || { name, shifts: 0, amount: 0, days: new Set() }
    p.shifts += Number(e.shifts)
    p.amount += Number(e.amount)
    p.days.add(e.entry_date)
    projects.set(name, p)
    const key = periodKey(e.entry_date, groupBy)
    const q = periods.get(key) || { key, label: periodLabel(key, groupBy), shifts: 0, amount: 0 }
    q.shifts += Number(e.shifts)
    q.amount += Number(e.amount)
    periods.set(key, q)
  }
  const byProject = [...projects.values()]
    .map((p) => ({ ...p, days: p.days.size, share: total ? p.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
  const byPeriod = [...periods.values()].sort((a, b) => a.key.localeCompare(b.key))
  return {
    inRange,
    total,
    shifts,
    avgPerShift: shifts ? total / shifts : 0,
    days: days.size,
    projectCount: projects.size,
    avgShiftsPerWeek: days.size ? shifts / Math.max(1, new Set(active.map((e) => weekStart(e.entry_date))).size) : 0,
    lastDate: active.reduce((m, e) => (!m || e.entry_date > m ? e.entry_date : m), null),
    byProject,
    byPeriod,
  }
}
