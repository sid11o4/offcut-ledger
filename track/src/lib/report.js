// Builds the data behind the printable daily reports (client-facing and internal).
// Pure: takes the plan, the day's report row and extras, returns plain numbers and lists.
import { activeTasks, itemPct, itemWeight, weighted } from './progress'

const num = (v) => Number(v) || 0

// Progress of every room at the start of the day and now, so rooms can show what moved.
function roomProgress(plan, startState, nowOf) {
  const rows = plan.items.map((i) => ({
    roomId: i.roomId,
    weight: itemWeight(i.cat, i.sqft),
    start: itemPct(i.cat, i.polish, startState[i.id] || []),
    now: itemPct(i.cat, i.polish, nowOf(i)),
  }))
  const pick = (list, key) => weighted(list.map((r) => ({ pct: r[key], weight: r.weight })))
  return {
    overallStart: pick(rows, 'start'),
    overallNow: pick(rows, 'now'),
    rooms: plan.rooms.map((r) => {
      const mine = rows.filter((x) => x.roomId === r.id)
      const start = pick(mine, 'start')
      const now = pick(mine, 'now')
      return { id: r.id, name: r.name, start, now, moved: now - start, items: mine.length }
    }),
  }
}

// report: a track_daily_reports row. dayNumber: 1-based count of report days up to this one.
export function buildReport({ project, plan, report, dayNumber = null, photos = [], requests = [] }) {
  const closed = Boolean(report.closed_at)
  const startState = report.start_state || {}
  const endState = report.end_state || {}
  // Days imported from the old tracker carry no task snapshots, so nothing can be said about what moved.
  const hasSnapshot = Object.keys(startState).length > 0 && (!closed || Object.keys(endState).length > 0)
  const nowOf = (i) => (closed && endState[i.id] ? endState[i.id] : i.progress)
  const rp = hasSnapshot ? roomProgress(plan, startState, nowOf) : { overallStart: 0, overallNow: 0, rooms: [] }
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]))

  // Task-level changes, grouped room -> item -> tasks, in plan order.
  const work = []
  let tasksMoved = 0
  let tasksCompleted = 0
  for (const it of hasSnapshot ? plan.items : []) {
    const before = startState[it.id] || []
    const after = nowOf(it)
    const tasks = activeTasks(it.cat, it.polish)
      .map((t, i) => ({ name: t.name, from: num(before[i]), to: num(after[i]) }))
      .filter((t) => t.from !== t.to)
    if (!tasks.length) continue
    tasksMoved += tasks.length
    tasksCompleted += tasks.filter((t) => t.from < 100 && t.to === 100).length
    let room = work.find((w) => w.roomId === it.roomId)
    if (!room) work.push(room = { roomId: it.roomId, room: roomName.get(it.roomId) || 'Unassigned', items: [] })
    room.items.push({
      id: it.id,
      title: it.title.trim(),
      category: it.cat?.name || '',
      start: itemPct(it.cat, it.polish, before),
      now: itemPct(it.cat, it.polish, after),
      tasks,
    })
  }

  const labour = (report.labour || []).filter((l) => l.trade || num(l.count))
  const headcount = labour.reduce((s, l) => s + num(l.count), 0)
  const manShifts = labour.reduce((s, l) => s + num(l.count) * (l.shifts === '' || l.shifts == null ? 1 : num(l.shifts)), 0)
  const materials = (report.materials || []).filter((m) => m.name)

  // Start and end are both recomputed from the task snapshots with today's weights, so a day where
  // nothing changed reads exactly 0 even if categories or areas were edited since the day started.
  const overall = hasSnapshot
    ? { start: rp.overallStart, end: rp.overallNow, moved: rp.overallNow - rp.overallStart }
    : { start: null, end: report.end_pct == null ? null : num(report.end_pct), moved: null }

  return {
    project: { name: project.name, client: project.client_name || '', location: project.location || '' },
    date: report.report_date,
    dayNumber,
    closed,
    closedAt: report.closed_at,
    hasSnapshot,
    overall,
    rooms: rp.rooms,
    roomsMoved: rp.rooms.filter((r) => Math.abs(r.moved) > 0.0005).length,
    roomsComplete: rp.rooms.filter((r) => r.items && r.now >= 0.9995).length,
    work,
    tasksMoved,
    tasksCompleted,
    labour,
    headcount,
    manShifts,
    materials,
    issues: (report.issues || '').trim(),
    nextPlan: (report.next_day_plan || '').trim(),
    photos,
    openRequests: requests.filter((r) => ['requested', 'approved'].includes(r.status)),
  }
}

// "Site day N": how many report days exist up to and including this date.
export function dayNumberOf(history, date) {
  const days = [...new Set(history.map((h) => h.report_date))].sort()
  const i = days.indexOf(date)
  return i === -1 ? days.filter((d) => d < date).length + 1 : i + 1
}

// Plain-language line for a task change, for the client report.
export function taskPhrase(t) {
  if (t.to === 100) return 'Completed'
  if (t.from === 0) return `Started · ${t.to}%`
  if (t.to < t.from) return `Revised to ${t.to}%`
  return `${t.from}% → ${t.to}%`
}

// Photo captions name the task a photo shows, stored as "Task · Item · Room" in track_photos.caption.
export const GENERAL_VIEW = 'General site view'
export function photoCaption({ task, item, room }) {
  return [task, item, room].map((s) => (s || '').trim()).filter(Boolean).join(' · ')
}
export function parseCaption(caption) {
  const [task = '', item = '', room = ''] = (caption || '').split(' · ')
  return { task, item, room }
}

// Everything a photo can be tagged with: tasks worked on today first, then every task by room and item.
export function photoTaskOptions(plan, changed = []) {
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]))
  const today = changed.map((c) => {
    const it = plan.items.find((i) => i.id === c.itemId)
    return photoCaption({ task: c.task, item: c.item, room: roomName.get(it?.roomId) })
  })
  const groups = plan.rooms.map((r) => ({
    label: r.name,
    options: plan.items.filter((i) => i.roomId === r.id).flatMap((i) =>
      activeTasks(i.cat, i.polish).map((t) => photoCaption({ task: t.name, item: i.title, room: r.name }))),
  })).filter((g) => g.options.length)
  return { today: [...new Set(today)], groups }
}

export const points =(p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(1)}`
