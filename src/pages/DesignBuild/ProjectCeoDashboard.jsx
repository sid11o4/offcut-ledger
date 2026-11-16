import { Fragment, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, EmptyState, LoadingBlock } from '../../components/ui'
import { loadProjectRaw, computeProjectCeo } from '../../lib/projectCeoData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// One colour per kind of expense, from the house palette: charcoal shades and one accent.
const COLOUR = { materials: '#33302b', labour: '#6b655c', factory: '#9c958a', misc: '#c9c3b8', other: '#b5462f' }
// Which tab each kind of expense opens.
const OPEN_TAB = { materials: 'materials', labour: 'labour', factory: 'factory', misc: 'misc', other: 'misc' }
const TABS = [
  ['overview', 'Overview'], ['materials', 'Materials'], ['labour', 'Labour'],
  ['factory', 'Factory job-work'], ['misc', 'Misc & other bills'], ['vendors', 'Vendors'],
]

export default function ProjectCeoDashboard() {
  const { id } = useParams()
  const rawQ = useQuery({ queryKey: ['project_ceo_raw', id], queryFn: () => loadProjectRaw(id) })
  const [range, setRange] = useState({ start: '', end: '' })
  const [tab, setTab] = useState('overview')

  const data = useMemo(() => (rawQ.data ? computeProjectCeo(rawQ.data, range) : null), [rawQ.data, range])

  if (rawQ.isLoading) return <LoadingBlock />
  if (rawQ.error) return <EmptyState title="Could not load this project" hint={rawQ.error.message} />
  if (!data) return null
  const p = data.project

  return (
    <div>
      <PageHeader
        title={p.name}
        subtitle={`${p.code} · ${p.clients?.name || 'No client set'} · ${p.status} · started ${displayDate(p.start_date)}`}
        actions={<Link className="btn-secondary" to={`/design-build/projects/${id}`}>Project page</Link>}
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">From<input type="date" className="field-input ml-2" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></label>
          <label className="text-sm">To<input type="date" className="field-input ml-2" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></label>
          <button className="btn-ghost text-sm" onClick={() => setRange({ start: '', end: '' })}>All time</button>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        <Kpi label="Budget" value={data.kpis.budget ? money(data.kpis.budget) : '—'} />
        <Kpi label="Spent" value={money(data.kpis.spent)} />
        <Kpi label="Used" value={data.kpis.used == null ? '—' : `${Math.round(data.kpis.used * 100)}%`} tone={data.kpis.used > 1 ? 'bad' : undefined} />
        <Kpi label="Remaining" value={data.kpis.remaining == null ? '—' : money(data.kpis.remaining)} tone={data.kpis.remaining < 0 ? 'bad' : undefined} />
        <Kpi label="Stock on hand" value={money(data.kpis.inventoryValue)} />
        <Kpi label="Vendors" value={data.kpis.vendorCount} />
        <Kpi label="Labour units" value={qty(data.kpis.labourQty)} />
        <Kpi label="Factory jobs" value={data.kpis.jobCount} />
      </div>

      <div className="flex flex-wrap gap-1 mb-5 border-b border-ink-200">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-ink-900 text-ink-950 font-medium' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} onOpen={setTab} />}
      {tab === 'materials' && <Materials data={data} />}
      {tab === 'labour' && <Labour data={data} />}
      {tab === 'factory' && <Factory data={data} />}
      {tab === 'misc' && <MiscOther data={data} />}
      {tab === 'vendors' && <Vendors data={data} />}
    </div>
  )
}

function Kpi({ label, value, tone }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-lg font-medium tnum mt-1 ${tone === 'bad' ? 'text-bad' : 'text-ink-950'}`}>{value}</div>
    </div>
  )
}

function Overview({ data, onOpen }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Split of expenses">
        {!data.slices.length ? <EmptyState title="No expenses in this period" /> : <Pie slices={data.slices} total={data.total} onOpen={onOpen} />}
      </Card>
      <Card title="Spend by month">
        {!data.trend.length ? <EmptyState title="No spend in this period" /> : <Trend trend={data.trend} />}
      </Card>
      <Card title="Top vendors">
        {!data.vendors.length ? <EmptyState title="No vendors yet" /> : <Bars rows={data.vendors.slice(0, 8).map((v) => ({ name: v.name, value: v.total }))} onClick={() => onOpen('vendors')} />}
      </Card>
      <Card title="Top materials consumed">
        {!data.materials.length ? <EmptyState title="No materials consumed yet" /> : <Bars rows={data.materials.slice(0, 8).map((m) => ({ name: m.name, value: m.cost }))} onClick={() => onOpen('materials')} />}
      </Card>
    </div>
  )
}

// Interactive: hover a slice to see its amount; click it to open that part of the report.
function Pie({ slices, total, onOpen }) {
  const [hover, setHover] = useState(null)
  const cx = 110, cy = 110, r = 100
  let angle = -Math.PI / 2
  const arcs = slices.map((s) => {
    const span = (s.value / total) * Math.PI * 2
    const start = angle, end = angle + span
    angle = end
    const large = span > Math.PI ? 1 : 0
    const d = span >= Math.PI * 2 - 1e-6
      ? `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`
      : `M${cx},${cy} L${cx + r * Math.cos(start)},${cy + r * Math.sin(start)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(end)},${cy + r * Math.sin(end)} Z`
    return { ...s, d }
  })
  const focus = arcs.find((a) => a.key === hover)
  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <svg viewBox="0 0 220 220" className="w-56 h-56 shrink-0">
        {arcs.map((a) => (
          <path key={a.key} d={a.d} fill={COLOUR[a.key]}
            opacity={hover && hover !== a.key ? 0.35 : 1}
            className="cursor-pointer transition-opacity"
            onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}
            onClick={() => onOpen(OPEN_TAB[a.key])}>
            <title>{`${a.label}: ${money(a.value)}`}</title>
          </path>
        ))}
      </svg>
      <div className="flex-1 w-full space-y-2">
        {slices.map((s) => (
          <button key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
            onClick={() => onOpen(OPEN_TAB[s.key])}
            className="w-full flex items-center justify-between text-sm rounded px-2 py-1 hover:bg-ink-50">
            <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOUR[s.key] }} />{s.label}</span>
            <span className="tnum">{money(s.value)} <span className="text-ink-500">· {Math.round((s.value / total) * 100)}%</span></span>
          </button>
        ))}
        {focus && <div className="text-xs text-ink-500 pt-1">Click to open {focus.label.toLowerCase()}.</div>}
      </div>
    </div>
  )
}

// Stacked bars per month; hover a month for its split.
function Trend({ trend }) {
  const [hover, setHover] = useState(null)
  const keys = ['materials', 'labour', 'factory', 'misc', 'other']
  const max = Math.max(...trend.map((m) => keys.reduce((s, k) => s + m[k], 0)), 1)
  const w = 560, h = 220, pad = 28
  const bw = (w - pad * 2) / trend.length
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56">
        {trend.map((m, i) => {
          let y = h - pad
          return (
            <g key={m.month} onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
              {keys.map((k) => {
                const v = m[k]
                const hgt = (v / max) * (h - pad * 2)
                y -= hgt
                return <rect key={k} x={pad + i * bw + 4} y={y} width={bw - 8} height={hgt} fill={COLOUR[k]} />
              })}
              <text x={pad + i * bw + bw / 2} y={h - 8} textAnchor="middle" fontSize="10" fill="#7d766d">{m.month.slice(5)}</text>
            </g>
          )
        })}
      </svg>
      <div className="text-xs text-ink-600 min-h-[1.25rem]">
        {hover ? `${hover.month}: ${keys.filter((k) => hover[k]).map((k) => `${k} ${money(hover[k])}`).join(' · ')}` : 'Hover a month to see its split.'}
      </div>
    </div>
  )
}

function Bars({ rows, onClick }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button key={r.name} onClick={onClick} className="w-full text-left group">
          <div className="flex justify-between text-sm"><span className="truncate pr-2 group-hover:underline">{r.name}</span><span className="tnum">{money(r.value)}</span></div>
          <div className="h-2 bg-ink-100 rounded"><div className="h-2 rounded bg-ink-900" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </button>
      ))}
    </div>
  )
}

function Materials({ data }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const rows = data.materials.filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input className="field-input max-w-xs" placeholder="Search materials" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="text-sm text-ink-600">Total consumed <span className="font-medium tnum">{money(data.materialsCost)}</span></div>
        </div>
      </Card>
      <Card title="Materials consumed">
        {!rows.length ? <EmptyState title="No materials consumed in this period" /> : (
          <table className="table-base">
            <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">Cost</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <Fragment key={m.name}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === m.name ? null : m.name)}>
                    <td className="font-medium">{m.name}</td>
                    <td className="num">{qty(m.quantity)} {m.unit}</td>
                    <td className="num">{money(m.cost)}</td>
                    <td className="text-right text-ink-500 text-xs">{open === m.name ? 'Hide vendors' : 'From vendors'}</td>
                  </tr>
                  {open === m.name && (
                    <tr key={`${m.name}-v`}>
                      <td colSpan={4} className="bg-ink-50">
                        <table className="table-base">
                          <tbody>
                            {[...m.vendors.entries()].sort((a, b) => b[1] - a[1]).map(([v, amt]) => (
                              <tr key={v}><td>{v}</td><td className="num">{money(amt)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Materials by source vendor">
        {!data.vendorMaterials.length ? <EmptyState title="No vendor-sourced materials yet" /> : (
          <Bars rows={data.vendorMaterials.map((v) => ({ name: v.name, value: v.amount }))} onClick={() => {}} />
        )}
      </Card>
    </div>
  )
}

function Labour({ data }) {
  return (
    <div className="space-y-5">
      <Card>
        <div className="text-sm text-ink-600">Labour cost <span className="font-medium tnum">{money(data.labourCost)}</span> · units <span className="font-medium tnum">{qty(data.labourQty)}</span></div>
      </Card>
      <Card title="Labour bills">
        {!data.labour.length ? <EmptyState title="No labour bills in this period" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Bill</th><th>Vendor</th><th>Description</th><th className="num">Units</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.labour.map((r) => (
                  <tr key={r.id}>
                    <td>{displayDate(r.date)}</td>
                    <td className="font-mono text-xs">{r.billNumber}</td>
                    <td>{r.vendor}</td>
                    <td>{r.description}</td>
                    <td className="num">{qty(r.quantity)} {r.unit_text || ''}</td>
                    <td className="num">{money(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Factory({ data }) {
  return (
    <div className="space-y-5">
      <Card title="Factory job-work (internal order), by service">
        {!data.jobs.length ? <EmptyState title="No factory job-work billed to this project" /> : (
          <table className="table-base">
            <thead><tr><th>Service</th><th className="num">Entries</th><th className="num">Quantity</th><th className="num">Billed</th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.name}><td className="font-medium">{j.name}</td><td className="num">{j.count}</td><td className="num">{qty(j.quantity)} {j.unit}</td><td className="num">{money(j.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Factory job-work entries">
        {!data.jobRows.length ? <EmptyState title="No entries" /> : (
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Service</th><th className="num">Quantity</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.jobRows.map((j) => (
                  <tr key={j.id}><td>{displayDate(j.entry_date)}</td><td>{j.job_work_services?.name}</td><td className="num">{qty(j.base_quantity)} {j.units?.code || ''}</td><td className="num">{money(j.total_amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function MiscOther({ data }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Miscellaneous expenses by category">
          {!data.miscByCategory.length ? <EmptyState title="No miscellaneous expenses" /> : <Bars rows={data.miscByCategory.map((c) => ({ name: c.name, value: c.amount }))} onClick={() => {}} />}
        </Card>
        <Card title="Other bills by cost head">
          {!data.other.length ? <EmptyState title="No other bills" /> : (
            <Bars rows={Object.entries(data.other.reduce((m, r) => ({ ...m, [r.cost_head || 'uncategorised']: (m[r.cost_head || 'uncategorised'] || 0) + Number(r.total_amount || 0) }), {})).map(([k, v]) => ({ name: k.replace(/_/g, ' '), value: v }))} onClick={() => {}} />
          )}
        </Card>
      </div>
      <Card title="Miscellaneous expenses">
        {!data.misc.length ? <EmptyState title="No entries" /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {data.misc.map((e) => (
                <tr key={e.id}><td>{displayDate(e.expense_date)}</td><td>{e.expense_categories?.name || 'Uncategorised'}</td><td>{e.description || ''}</td><td className="num">{money(e.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Other bills">
        {!data.other.length ? <EmptyState title="No entries" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Bill</th><th>Vendor</th><th>Description</th><th>Cost head</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.other.map((r) => (
                  <tr key={r.id}><td>{displayDate(r.date)}</td><td className="font-mono text-xs">{r.billNumber}</td><td>{r.vendor}</td><td>{r.description}</td><td className="capitalize">{(r.cost_head || '—').replace(/_/g, ' ')}</td><td className="num">{money(r.total_amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Vendors({ data }) {
  return (
    <Card title="Vendors this project has paid or drawn from">
      {!data.vendors.length ? <EmptyState title="No vendors yet" /> : (
        <table className="table-base">
          <thead><tr><th>Vendor</th><th className="num">Materials</th><th className="num">Labour</th><th className="num">Other bills</th><th className="num">Total</th></tr></thead>
          <tbody>
            {data.vendors.map((v) => (
              <tr key={v.name}>
                <td className="font-medium">{v.name}</td>
                <td className="num">{v.materials ? money(v.materials) : '—'}</td>
                <td className="num">{v.labour ? money(v.labour) : '—'}</td>
                <td className="num">{v.other ? money(v.other) : '—'}</td>
                <td className="num font-medium">{money(v.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
