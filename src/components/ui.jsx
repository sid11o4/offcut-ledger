export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
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
          {title && <h2 className="text-sm font-semibold text-ink-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

export function StatCard({ label, value, sub, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'text-ink-900',
    ok: 'text-ok',
    bad: 'text-bad',
    brand: 'text-brand-700',
  }[tone]
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500 mt-1">{sub}</div>}
    </div>
  )
}

export function EmptyState({ title = 'Nothing here yet', hint }) {
  return (
    <div className="text-center py-10 text-ink-500">
      <div className="text-sm font-medium text-ink-700">{title}</div>
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

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-ink-500 text-sm py-8 justify-center">
      <Spinner /> {label}
    </div>
  )
}

export function StatusBadge({ status }) {
  const tones = {
    draft: 'neutral', active: 'ok', on_hold: 'warn', completed: 'brand', closed: 'neutral',
    cancelled: 'bad', issued: 'brand', accepted: 'ok', rejected: 'bad', expired: 'neutral',
    paid: 'ok', partially_paid: 'warn', unpaid: 'bad', partial: 'warn', open: 'ok', locked: 'neutral',
    void: 'bad',
  }
  const label = String(status || '').replace(/_/g, ' ')
  return <Badge tone={tones[status] || 'neutral'}>{label}</Badge>
}
