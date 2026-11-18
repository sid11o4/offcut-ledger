import PayReceiveCards from '../../components/PayReceiveCards'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, EmptyState, LoadingBlock, StatCard, Select } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'
import { saveDoc } from '../../lib/reportPdf'
import CostBreakdown from '../../components/CostBreakdown'
import { loadProjectSummary, loadExpensesByCategory, loadMaterials, loadLabour, designReportPdf } from '../../lib/designReportData'

// Design Build's detailed reports. One page, four sections, each reachable from its own sidebar
// subheader: Projects, Expenses, Materials and Labour. Each section has a Download PDF button that
// builds the PDF from the same data the page shows.
export const DESIGN_REPORT_SECTIONS = {
  projects: { title: 'Project summary', subtitle: 'Every Design Build project with its contract value and what is spent (every cost charged to it, plus the stock it holds).' },
  expenses: { title: 'Expenses by category', subtitle: 'Design Build expenses grouped by category, with the split by project or company.' },
  materials: { title: 'Materials consumed', subtitle: 'Stock used on each project in the period, at average cost.' },
  labour: { title: 'Labour', subtitle: 'Labour bills and labour expenses in the period, by project.' },
}

export default function DesignReports({ section }) {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const meta = DESIGN_REPORT_SECTIONS[section]
  const period = section === 'projects' ? null : `${displayDate(start)} – ${displayDate(end)}`

  const q = useQuery({
    queryKey: ['design_report', section, section === 'projects' ? '' : start, section === 'projects' ? '' : end],
    queryFn: () => {
      if (section === 'projects') return loadProjectSummary()
      if (section === 'expenses') return loadExpensesByCategory(start, end)
      if (section === 'materials') return loadMaterials(start, end)
      return loadLabour(start, end)
    },
  })

  function downloadPdf() {
    if (!q.data) return
    const doc = designReportPdf(section, q.data, { title: meta.title, subtitle: 'Design Build', period })
    saveDoc(doc, `design-build-${section}${period ? `-${start}-to-${end}` : ''}`)
  }

  return (
    <div>
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        actions={q.data && <button className="btn-secondary text-xs" onClick={downloadPdf}>Download PDF</button>}
      />
      <PayReceiveCards />
      {section !== 'projects' && (
        <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>
      )}
      {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load this report" hint={q.error.message} /> : (
        <>
          {section === 'projects' && <ProjectSummary rows={q.data} />}
          {section === 'expenses' && <ExpensesByCategory data={q.data} />}
          {section === 'materials' && <MaterialsConsumed data={q.data} />}
          {section === 'labour' && <LabourReport data={q.data} />}
        </>
      )}
    </div>
  )
}

function ProjectSummary({ rows }) {
  if (!rows.length) return <EmptyState title="No Design Build projects yet" />
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const totalContract = rows.reduce((s, r) => s + r.contract, 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total contract value" value={money(totalContract)} />
        <StatCard label="Total spent" value={money(totalSpent)} tone="bad" />
        <StatCard label="Total left of contract" value={money(totalContract - totalSpent)} tone={totalContract - totalSpent >= 0 ? 'ok' : 'bad'} />
      </div>
      <Card>
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th className="num">Contract value</th><th className="num">Labour</th><th className="num">Materials consumed</th><th className="num">Job work, transport &amp; other</th><th className="num">Project inventory</th><th className="num">Spent</th><th className="num">Left of contract</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.client || '—'}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="num">{r.contract ? money(r.contract) : '—'}</td>
                  <td className="num">{money(r.labour)}</td>
                  <td className="num">{money(r.materials)}</td>
                  <td className="num">{money(r.other)}</td>
                  <td className="num">{money(r.inventory)}</td>
                  <td className="num font-medium">{money(r.spent)}</td>
                  <td className={`num ${r.left >= 0 ? 'text-ok' : 'text-bad'}`}>{r.contract ? money(r.left) : '—'}</td>
                  <td className="text-right"><Link className="btn-ghost text-xs px-2" to={`/design-build/projects/${r.id}/report`}>Report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function ExpensesByCategory({ data }) {
  if (!data.rows.length) return <EmptyState title="No Design Build costs in this period" />
  return (
    <Card>
      <div className="overflow-x-auto -mx-4">
        <CostBreakdown rows={data.rows} showPlaces />
      </div>
    </Card>
  )
}

function MaterialsConsumed({ data }) {
  const [only, setOnly] = useState('')
  if (!data.projects.length) return <EmptyState title="No materials consumed in this period" />
  const shown = only ? data.projects.filter((p) => p.name === only) : data.projects
  const total = shown.reduce((t, p) => t + p.cost, 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={only} onChange={(e) => setOnly(e.target.value)} className="w-auto">
          <option value="">All projects</option>
          {data.projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </Select>
        <span className="text-sm text-ink-500">{shown.length} project{shown.length === 1 ? '' : 's'} · <span className="tnum font-medium text-ink-900">{money(total)}</span> consumed</span>
      </div>
      {shown.map((p) => (
        <Card key={p.name} title={p.name} actions={<span className="tnum font-semibold text-ink-950">{money(p.cost)}</span>}>
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Category / material</th><th className="num">Quantity</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {p.groups.map((g) => (
                  <Fragment key={g.name}>
                    <tr className="bg-ink-50">
                      <td className="font-medium">{g.name}</td><td />
                      <td className="num font-medium">{money(g.cost)}</td>
                    </tr>
                    {g.items.map((i) => (
                      <tr key={i.name}>
                        <td className="pl-8">{i.name}</td>
                        <td className="num">{qty(i.quantity)} {i.unit}</td>
                        <td className="num">{money(i.cost)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td className="font-medium">Total</td><td /><td className="num font-medium">{money(p.cost)}</td></tr></tfoot>
            </table>
          </div>
        </Card>
      ))}
    </div>
  )
}

function LabourReport({ data }) {
  if (!data.lines.length) return <EmptyState title="No labour recorded in this period" />
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total labour" value={money(data.total)} tone="bad" />
      </div>
      <Card>
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Date</th><th>Project</th><th>Description</th><th>Supplier / category</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={i}><td>{displayDate(l.date)}</td><td>{l.project}</td><td>{l.description}</td><td>{l.party}</td><td className="num">{money(l.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="font-medium">Total</td><td className="num font-medium">{money(data.total)}</td></tr></tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}
