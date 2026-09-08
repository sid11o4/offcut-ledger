import { today, isoDaysAgo, startOfThisMonth, startOfLastMonth, endOfLastMonth, startOfYear, startOfWeek } from '../lib/dates'

export function presetRanges() {
  const t = today()
  return {
    Today: [t, t],
    Yesterday: [isoDaysAgo(1), isoDaysAgo(1)],
    'This week': [startOfWeek(t), t],
    'Last week': [(() => { const s = new Date(startOfWeek(t) + 'T00:00:00Z'); s.setUTCDate(s.getUTCDate() - 7); return s.toISOString().slice(0, 10) })(),
      (() => { const s = new Date(startOfWeek(t) + 'T00:00:00Z'); s.setUTCDate(s.getUTCDate() - 1); return s.toISOString().slice(0, 10) })()],
    'This month': [startOfThisMonth(), t],
    'Last month': [startOfLastMonth(), endOfLastMonth()],
    'Year to date': [startOfYear(), t],
  }
}

export default function DateRangePicker({ start, end, onChange }) {
  const presets = presetRanges()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {Object.entries(presets).map(([label, [s, e]]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(s, e)}
            className={`btn-ghost text-xs ${start === s && end === e ? 'bg-ink-100' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 ml-auto">
        <input type="date" className="field-input w-auto" value={start} onChange={(e) => onChange(e.target.value, end)} />
        <span className="text-ink-400 text-sm">to</span>
        <input type="date" className="field-input w-auto" value={end} onChange={(e) => onChange(start, e.target.value)} />
      </div>
    </div>
  )
}
