// Progress maths, unchanged from the previous tracker (and mirrored in SQL by track_item_progress).
// A category is { weight, hasPolish, tasks: [{ name, points }] }.
// Item % = sum(task points * done%) / sum(points); polish (when on) adds a task worth base/9.
// Item weight = sqft * category weight. Room and overall % are weight-averaged.

export function activeTasks(cat, polish) {
  if (!cat) return []
  const tasks = (cat.tasks || []).map((t) => ({ name: t.name, pts: Number(t.points) || 0, isPolish: false }))
  if (cat.hasPolish && polish === 'Yes') {
    const base = tasks.reduce((s, t) => s + t.pts, 0)
    tasks.push({ name: 'Polish / paint', pts: base / 9, isPolish: true })
  }
  return tasks
}

// progress: array of 0-100 per task, same order as activeTasks. Returns 0..1.
export function itemPct(cat, polish, progress = []) {
  const tasks = activeTasks(cat, polish)
  const total = tasks.reduce((s, t) => s + t.pts, 0)
  if (!total) return 0
  const done = tasks.reduce((s, t, i) => s + (t.pts * (Number(progress[i]) || 0)) / 100, 0)
  return done / total
}

export function itemWeight(cat, sqft) {
  return cat ? (Number(sqft) || 0) * cat.weight : 0
}

// rows: [{ pct, weight }]
export function weighted(rows) {
  let n = 0
  let d = 0
  for (const r of rows) {
    n += r.pct * r.weight
    d += r.weight
  }
  return d > 0 ? n / d : 0
}

export function statusLabel(p) {
  if (p <= 0) return 'Not started'
  if (p >= 1) return 'Complete'
  if (p >= 0.75) return 'Advanced'
  if (p >= 0.5) return 'Halfway'
  return 'Started'
}

// Local calendar day, not the UTC day: toISOString() flips a day early for timezones ahead of UTC.
export function localDateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const pct = (p) => `${Math.round((p || 0) * 100)}%`

// What moved today: compares the start-of-day progress with now.
// items: [{ id, title, roomId, cat, polish, sqft, progress }]; startState: { [id]: progress[] }
export function dayChanges(items, startState) {
  const changed = []
  const completed = []
  for (const it of items) {
    const before = startState[it.id] || []
    const tasks = activeTasks(it.cat, it.polish)
    tasks.forEach((t, i) => {
      const a = Number(before[i]) || 0
      const b = Number(it.progress[i]) || 0
      if (a !== b) changed.push({ itemId: it.id, item: it.title, task: t.name, from: a, to: b })
      if (a < 100 && b === 100) completed.push({ item: it.title, task: t.name })
    })
  }
  return { changed, completed }
}

export function snapshotOf(items) {
  return Object.fromEntries(items.map((it) => [it.id, [...it.progress]]))
}
