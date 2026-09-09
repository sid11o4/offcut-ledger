import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

const DIMENSIONS = [
  { key: 'report_revenue_by_project', label: 'By Project', cols: [['project_name', 'Project'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_service', label: 'By Job Work', cols: [['service_name', 'Job Work'], ['total_quantity', 'Quantity'], ['unit_code', 'Unit'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_process', label: 'By Process', cols: [['process_name', 'Process'], ['total_quantity', 'Quantity'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_machine', label: 'By Machine', cols: [['machine_name', 'Machine'], ['total_quantity', 'Quantity'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_rate_category', label: 'By Rate Category', cols: [['rate_category_name', 'Rate Category'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_date', label: 'By Date', cols: [['entry_date', 'Date'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
]

export default function Reports() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [dim, setDim] = useState(DIMENSIONS[0])

  const dataQ = useQuery({
    queryKey: ['report', dim.key, start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(dim.key, { p_start: start, p_end: end })
      if (error) throw error
      return data
    },
  })

  const billingQ = useQuery({
    queryKey: ['report_billing_status', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_billing_status', { p_start: start, p_end: end })
      if (error) throw error
      return data?.[0]
    },
  })

  const rows = dataQ.data || []
  const total = rows.reduce((s, r) => s + Number(r.revenue || 0), 0)

  function exportCsv() {
    const csv = Papa.unparse(rows.map((r) => {
      const out = {}
      for (const [k, label] of dim.cols) out[label] = k === 'entry_date' ? displayDate(r[k]) : r[k]
      return out
    }))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `formgrid-${dim.key}-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="Factory Reports" subtitle="Any date range, drilled down by project, job work, process, machine or rate category." />

      <Card className="mb-5">
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Revenue" value={money(total)} tone="brand" />
        <StatCard label="Billed" value={money(billingQ.data?.billed_revenue)} tone="ok" />
        <StatCard label="Unbilled" value={money(billingQ.data?.unbilled_revenue)} tone="warn" />
        <StatCard label="Job Entries" value={(billingQ.data?.billed_count || 0) + (billingQ.data?.unbilled_count || 0)} />
      </div>

      <div className="flex flex-wrap gap-1 mb-3 border-b border-ink-200">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDim(d)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${dim.key === d.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <Card actions={rows.length > 0 && <button className="btn-secondary text-xs" onClick={exportCsv}>Export CSV</button>}>
        {dataQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No revenue in this period" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr>{dim.cols.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {dim.cols.map(([k]) => (
                      <td key={k}>
                        {k === 'revenue' ? money(r[k]) : k === 'entry_date' ? displayDate(r[k]) : k === 'total_quantity' ? qty(r[k]) : r[k]}
                      </td>
                    ))}
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
