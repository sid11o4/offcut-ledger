import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, EmptyState, LoadingBlock, StatCard } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'
import { saveDoc } from '../../lib/reportPdf'
import { loadProjectSummary, loadExpensesByCategory, loadMaterials, loadLabour, designReportPdf } from '../../lib/designReportData'

// Design Build's detailed reports. One page, four sections, each reachable from its own sidebar
// subheader: Projects, Expenses, Materials and Labour. Each section has a Download PDF button that
// builds the PDF from the same data the page shows.
export const DESIGN_REPORT_SECTIONS = {
  projects: { title: 'Project summary', subtitle: 'Every Design Build project with its budget, spend and headroom.' },
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
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total budget" value={money(totalBudget)} />
        <StatCard label="Total spent" value={money(totalSpent)} tone="bad" />
        <StatCard label="Total headroom" value={money(totalBudget - totalSpent)} tone={totalBudget - totalSpent >= 0 ? 'ok' : 'bad'} />
      </div>
      <Card>
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th className="num">Budget</th><th className="num">Supplier bills</th><th className="num">Internal Order</th><th className="num">Direct</th><th className="num">Spent</th><th className="num">Headroom</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.client || '—'}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="num">{r.budget ? money(r.budget) : '—'}</td>
                  <td className="num">{money(r.bills)}</td>
                  <td className="num">{money(r.internal)}</td>
                  <td className="num">{money(r.direct)}</td>
                  <td className="num font-medium">{money(r.spent)}</td>
                  <td className={`num ${r.headroom >= 0 ? 'text-ok' : 'text-bad'}`}>{r.budget ? money(r.headroom) : '—'}</td>
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
  if (!data.categories.length) return <EmptyState title="No Design Build expenses in this period" />
  return (
    <Card>
      <div className="overflow-x-auto -mx-4">
        <table className="table-base">
          <thead><tr><th>Category / charged to</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
          <tbody>
            {data.categories.map((c) => (
              <CategoryRows key={c.name} category={c} grand={data.grand} />
            ))}
          </tbody>
          <tfoot><tr><td className="font-medium">Total</td><td className="num font-medium">{money(data.grand)}</td><td /></tr></tfoot>
        </table>
      </div>
    </Card>
  )
}

function CategoryRows({ category, grand }) {
  return (
    <>
      <tr className="bg-ink-50">
        <td className="font-medium">{category.name}</td>
        <td className="num font-medium">{money(category.total)}</td>
        <td className="num">{grand ? `${((category.total / grand) * 100).toFixed(1)}%` : '—'}</td>
      </tr>
      {category.places.map(([place, amount]) => (
        <tr key={place}>
          <td className="pl-8 text-ink-600">{place}</td>
          <td className="num">{money(amount)}</td>
          <td className="num text-ink-500">{category.total ? `${((amount / category.total) * 100).toFixed(1)}%` : '—'}</td>
        </tr>
      ))}
    </>
  )
}

function MaterialsConsumed({ data }) {
  if (!data.projects.length) return <EmptyState title="No materials consumed in this period" />
  return (
    <Card>
      <div className="overflow-x-auto -mx-4">
        <table className="table-base">
          <thead><tr><th>Project / material</th><th className="num">Quantity</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {data.projects.map((p) => (
              <ProjectMaterialRows key={p.name} project={p} />
            ))}
          </tbody>
          <tfoot><tr><td className="font-medium">Total</td><td /><td className="num font-medium">{money(data.grand)}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  )
}

function ProjectMaterialRows({ project }) {
  return (
    <>
      <tr className="bg-ink-50">
        <td className="font-medium">{project.name}</td><td />
        <td className="num font-medium">{money(project.cost)}</td>
      </tr>
      {project.items.map((i) => (
        <tr key={i.name}>
          <td className="pl-8">{i.name}</td>
          <td className="num">{qty(i.quantity)} {i.unit}</td>
          <td className="num">{money(i.cost)}</td>
        </tr>
      ))}
    </>
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
