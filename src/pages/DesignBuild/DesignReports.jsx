import PayReceiveCards from '../../components/PayReceiveCards'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, EmptyState, LoadingBlock, StatCard } from '../../components/ui'
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
  projects: { title: 'Project summary', subtitle: 'Every Design Build project with its contract value, spend and what is left of the contract.' },
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
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th className="num">Contract value</th><th className="num">Supplier bills</th><th className="num">Design Build Order</th><th className="num">Direct</th><th className="num">Spent</th><th className="num">Left of contract</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.client || '—'}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="num">{r.contract ? money(r.contract) : '—'}</td>
                  <td className="num">{money(r.bills)}</td>
                  <td className="num">{money(r.internal)}</td>
                  <td className="num">{money(r.direct)}</td>
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
