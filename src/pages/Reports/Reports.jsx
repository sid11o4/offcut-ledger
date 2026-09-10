import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Each dimension's row key -> how to drill into its underlying transactions (spec section
// 19/43: "Users should be able to drill down from summary figures into underlying
// transactions."). 'project' and 'date' have their own full pages already (project report /
// daily log) which show far more than a modal could, so those navigate there directly;
// the rest open a lightweight modal filtered to that exact slice + the report's date range.
const DIMENSIONS = [
  { key: 'report_revenue_by_project', label: 'By Project', rowKey: 'project_id', drill: 'project', cols: [['project_name', 'Project'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_service', label: 'By Job Work', rowKey: 'service_id', drill: 'service', cols: [['service_name', 'Job Work'], ['total_quantity', 'Quantity'], ['unit_code', 'Unit'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_process', label: 'By Process', rowKey: 'process_id', drill: 'process', cols: [['process_name', 'Process'], ['total_quantity', 'Quantity'], ['unit_code', 'Unit'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_machine', label: 'By Machine', rowKey: 'machine_id', drill: 'machine', cols: [['machine_name', 'Machine'], ['total_quantity', 'Quantity'], ['unit_code', 'Unit'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_rate_category', label: 'By Rate Category', rowKey: 'rate_category_id', drill: 'rate_category', cols: [['rate_category_name', 'Rate Category'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
  { key: 'report_revenue_by_date', label: 'By Date', rowKey: 'entry_date', drill: 'date', cols: [['entry_date', 'Date'], ['entry_count', 'Entries'], ['revenue', 'Revenue']] },
]

export default function Reports() {
  const navigate = useNavigate()
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [dim, setDim] = useState(DIMENSIONS[0])
  const [drillRow, setDrillRow] = useState(null)

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

  function drillInto(row) {
    if (dim.drill === 'project') return navigate(`/reports/projects/${row.project_id}`)
    if (dim.drill === 'date') return navigate(`/daily-log?date=${row.entry_date}`)
    setDrillRow(row)
  }

  return (
    <div>
      <PageHeader title="Factory Reports" subtitle="Any date range, drilled down by project, job work, process, machine or rate category — click any row to see the underlying entries." />

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
                  <tr key={i} onClick={() => drillInto(r)} className="cursor-pointer hover:bg-ink-50">
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

      {drillRow && (
        <DrillModal dim={dim} row={drillRow} start={start} end={end} onClose={() => setDrillRow(null)} />
      )}
    </div>
  )
}

function DrillModal({ dim, row, start, end, onClose }) {
  const drillQ = useQuery({
    queryKey: ['report-drill', dim.drill, row[dim.rowKey], start, end],
    queryFn: async () => {
      let q = supabase
        .from('job_work_entries')
        .select('id, entry_date, base_quantity, total_amount, billed, status, projects(name), job_work_services(name), units(code)')
        .eq('status', 'active')
        .gte('entry_date', start)
        .lte('entry_date', end)

      if (dim.drill === 'service') q = q.eq('service_id', row.service_id)
      else if (dim.drill === 'rate_category') q = q.eq('rate_category_id', row.rate_category_id)
      else if (dim.drill === 'process' || dim.drill === 'machine') {
        // Neither column lives on job_work_entries itself -- only on its components -- so an
        // inner join against the matching component row is required to filter correctly.
        const col = dim.drill === 'process' ? 'process_id' : 'machine_id'
        q = supabase
          .from('job_work_entries')
          .select('id, entry_date, base_quantity, total_amount, billed, status, projects(name), job_work_services(name), units(code), job_work_entry_components!inner(process_id, machine_id)')
          .eq('status', 'active')
          .gte('entry_date', start)
          .lte('entry_date', end)
          .eq(`job_work_entry_components.${col}`, row[dim.rowKey])
      }

      q = q.order('entry_date', { ascending: false }).limit(200)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const rows = drillQ.data || []
  const label = dim.cols[0][0] === 'entry_date' ? displayDate(row.entry_date) : (row.project_name || row.service_name || row.process_name || row.machine_name || row.rate_category_name)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-ink-900">{dim.label} — {label}</div>
          <button className="btn-ghost text-xs px-2" onClick={onClose}>Close</button>
        </div>
        {drillQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No underlying entries found" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Project</th><th>Job Work</th><th>Qty</th><th>Amount</th><th>Billing</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{displayDate(e.entry_date)}</td>
                    <td>{e.projects?.name}</td>
                    <td>{e.job_work_services?.name}</td>
                    <td>{qty(e.base_quantity)} {e.units?.code}</td>
                    <td className="font-medium">{money(e.total_amount)}</td>
                    <td>{e.billed ? 'Billed' : 'Unbilled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
