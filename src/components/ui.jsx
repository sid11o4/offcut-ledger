import { Link } from 'react-router-dom'

// Achromatic ledger components (design-taste-frontend, kind=finance, dealt Oct 2026). House
// rules this follows throughout: a noun title (never a greeting), KPIs as type with no icon
// circles or sparklines, 1px borders instead of shadows, pale-tint status pills, right-aligned
// tabular figures, colour only on data and the one primary action.

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '', title, actions }) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h2 className="text-sm font-medium text-ink-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

// A KPI row: label above value, grey label, value in ink (bold only for money), no icon, no
// tile unless told to use one, no sparkline. `tone` colours only a true signal (a bad number),
// never decoration -- most KPIs should pass no tone at all and read in plain ink.
export function StatCard({ label, value, sub, tone = 'neutral', money = false }) {
  const toneClass = { neutral: 'text-ink-950', ok: 'text-ok', bad: 'text-bad', brand: 'text-brand-600' }[tone]
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-2xl sm:text-[28px] leading-tight mt-1 tabular-nums whitespace-nowrap ${toneClass} ${money ? 'font-bold' : 'font-medium'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-500 mt-1">{sub}</div>}
    </div>
  )
}

// A divided container for a KPI row (the style's default, instead of separate tiles): equal
// columns split by 1px dividers.
export function StatRow({ children }) {
  return <div className="grid divide-x divide-ink-200" style={{ gridTemplateColumns: `repeat(${Array.isArray(children) ? children.length : 1}, 1fr)` }}>
    {Array.isArray(children) ? children.map((c, i) => <div key={i} className={i === 0 ? '' : 'pl-4'}>{c}</div>) : children}
  </div>
}

// A dashboard tile: a label, a large tabular figure, and an optional spend bar. `progress` is a
// share (0-1) of a budget; past 1 the bar turns red. With `to`, the whole tile is a link.
export function Tile({ label, value, sub, to, progress }) {
  const bar = progress == null ? null : (
    <div
      role="img"
      aria-label={`${Math.round(progress * 100)}% of budget used`}
      className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-100"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${progress > 1 ? 'bg-bad' : 'bg-ink-900'}`}
        style={{ width: `${Math.min(progress, 1) * 100}%` }}
      />
    </div>
  )
  const content = (
    <>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-ink-950 sm:text-[28px]">{value}</div>
      {bar}
      {sub && <div className="mt-2 text-xs text-ink-500">{sub}</div>}
    </>
  )
  return to
    ? <Link to={to} className="card card-interactive block p-4">{content}</Link>
    : <div className="card p-4">{content}</div>
}

export function EmptyState({ title = 'Nothing here yet', hint }) {
  return (
    <div className="text-center py-10 text-ink-500">
      <div className="text-sm text-ink-700">{title}</div>
      {hint && <div className="text-xs mt-1">{hint}</div>}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge-${tone}`}>{children}</span>
}

export function Label({ children }) {
  return <label className="field-label">{children}</label>
}

export function Input(props) {
  return <input {...props} className={`field-input ${props.className || ''}`} />
}

export function Select({ children, ...props }) {
  return (
    <select {...props} className={`field-input ${props.className || ''}`}>
      {children}
    </select>
  )
}

export function Textarea(props) {
  return <textarea {...props} className={`field-input ${props.className || ''}`} />
}

export function Field({ label, children, hint }) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <div className="text-xs text-ink-400 mt-1">{hint}</div>}
    </div>
  )
}

// Settings-pattern toggle row: 14/500 title, grey description, a 28x16 switch at the right.
export function ToggleField({ title, description, checked, onChange }) {
  return (
    <label className="flex items-center justify-between py-1 cursor-pointer select-none">
      <div>
        <div className="text-sm font-medium text-ink-900">{title}</div>
        {description && <div className="text-xs text-ink-500 mt-0.5">{description}</div>}
      </div>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-ink-900' : 'bg-ink-200'}`}
      >
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </span>
    </label>
  )
}

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// Shimmering placeholder lines in the shape of content, so a page loads into its own layout.
export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div role="status" className="space-y-3 py-6">
      <span className="sr-only">{label}</span>
      <div className="skeleton h-4 w-2/5 rounded" />
      <div className="skeleton h-4 w-full rounded" />
      <div className="skeleton h-4 w-4/5 rounded" />
    </div>
  )
}

export function StatusBadge({ status }) {
  const tones = {
    draft: 'neutral', active: 'ok', on_hold: 'warn', completed: 'brand', closed: 'neutral',
    cancelled: 'bad', issued: 'brand', accepted: 'ok', rejected: 'bad', expired: 'neutral',
    paid: 'ok', partially_paid: 'warn', unpaid: 'bad', partial: 'warn', open: 'ok', locked: 'neutral',
    void: 'bad', pending_review: 'warn', approved: 'ok', confirmed: 'ok', pending: 'warn',
  }
  const label = String(status || '').replace(/_/g, ' ')
  return <Badge tone={tones[status] || 'neutral'}>{label}</Badge>
}

// A 0-1 confidence score as the small pale pill used across the Bill Audit Queue: green at or
// above the 95% auto-apply bar, amber below it.
export function ConfidencePill({ value }) {
  if (value == null) return null
  const pct = Math.round(value * 100)
  return <Badge tone={value >= 0.95 ? 'ok' : 'warn'}>{pct}%</Badge>
}
