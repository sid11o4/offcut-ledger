import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { useAppSettings } from '../../lib/queries'
import { generateProjectReportPdf } from '../../lib/pdf'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

export default function ProjectReport() {
  const { id } = useParams()
  const preset = presetRanges()['Year to date']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])

  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*, clients(name), rate_categories(name)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const finQ = useQuery({
    queryKey: ['project-financials', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_financials', { p_project_id: id })
      if (error) throw error
      return data?.[0]
    },
  })

  const entriesQ = useQuery({
    queryKey: ['project-report-entries', id, start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('*, job_work_services(name), units(code)')
        .eq('project_id', id)
        .gte('entry_date', start)
        .lte('entry_date', end)
        .order('entry_date')
      if (error) throw error
      return data
    },
  })

  const project = projectQ.data
  const rows = entriesQ.data || []
  const periodTotal = rows.filter((r) => r.status === 'active').reduce((s, r) => s + Number(r.total_amount), 0)
  const settingsQ = useAppSettings()

  function downloadPdf() {
    if (!project) return
    generateProjectReportPdf({
      settings: settingsQ.data, start, end, project, financials: finQ.data, entries: rows, periodTotal,
    })
  }

  return (
    <div>
      <PageHeader
        title={project ? `${project.name} — Project Report` : 'Project Report'}
        subtitle={project ? `${project.code} · ${project.clients?.name} · ${project.rate_categories?.name}` : ''}
        actions={<button className="btn-secondary" disabled={!project} onClick={downloadPdf}>Download PDF</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="Actual Revenue (all time)" value={money(finQ.data?.actual_revenue)} tone="brand" />
        <StatCard label="Billed" value={money(finQ.data?.billed_revenue)} tone="ok" />
        <StatCard label="Unbilled" value={money(finQ.data?.unbilled_revenue)} tone="warn" />
        <StatCard label="Expenses" value={money(finQ.data?.total_expenses)} tone="bad" />
        <StatCard label="Period Revenue" value={money(periodTotal)} />
      </div>

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>

      <Card title="Date-wise Work">
        {entriesQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No work in this period" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Job Work</th><th>Quantity</th><th>Unit</th><th>Amount</th><th>Billing Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-40 line-through' : ''}>
                    <td>{displayDate(r.entry_date)}</td>
                    <td>{r.job_work_services?.name}</td>
                    <td>{qty(r.base_quantity)}</td>
                    <td>{r.units?.code}</td>
                    <td className="font-medium">{money(r.total_amount)}</td>
                    <td>
                      {r.status === 'cancelled' ? <Badge tone="bad">Cancelled</Badge> : r.billed ? <Badge tone="ok">Billed</Badge> : <Badge tone="warn">Unbilled</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4}>Period Total</td>
                  <td>{money(periodTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
