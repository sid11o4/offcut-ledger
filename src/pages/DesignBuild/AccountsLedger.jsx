import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock, Badge } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money } from '../../lib/format'

// Design Build's own books, kept separate from Factory's. Internal Order job-work is a Factory
// income and a Design Build cost against the specific project it was done for.
export default function AccountsLedger() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])

  const statementQ = useQuery({
    queryKey: ['db_statement', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('design_build_statement', { p_start: start, p_end: end })
      if (error) throw error
      return data || []
    },
  })

  const ledgerQ = useQuery({
    queryKey: ['db_ledger', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('design_build_ledger', { p_start: start, p_end: end })
      if (error) throw error
      return data || []
    },
  })

  const statement = statementQ.data || []
  const ledger = ledgerQ.data || []
  const totalBills = statement.reduce((s, r) => s + Number(r.supplier_bills_total), 0)
  const totalInternal = statement.reduce((s, r) => s + Number(r.internal_order_total), 0)
  const totalDirect = statement.reduce((s, r) => s + Number(r.direct_expenses || 0), 0)
  const totalExpense = totalBills + totalInternal + totalDirect

  let running = 0
  const withBalance = [...ledger].reverse().map((r) => {
    running += Number(r.amount)
    return { ...r, balance: running }
  }).reverse()

  function exportCsv() {
    const csv = Papa.unparse(withBalance.map((r) => ({
      Date: displayDate(r.txn_date), Category: r.category, Project: r.project_name || 'Company',
      Description: r.description, Reference: r.reference, Amount: r.amount,
    })))
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `design-build-ledger-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Design Build Ledger & Statement"
        subtitle="Design Build's own books: supplier costs, Internal Order cost and direct expenses, per project and for the company."
        actions={ledger.length > 0 && <button className="btn-secondary text-xs" onClick={exportCsv}>Export CSV</button>}
      />

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Supplier bills (approved)" value={money(totalBills)} />
        <StatCard label="Internal Order cost" value={money(totalInternal)} />
        <StatCard label="Direct expenses" value={money(totalDirect)} />
        <StatCard label="Total expense" value={money(totalExpense)} tone="bad" />
      </div>

      <Card title="Statement by project" className="mb-5">
        {statementQ.isLoading ? <LoadingBlock /> : !statement.length ? <EmptyState title="No Design Build projects yet" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Project</th><th className="num">Supplier bills</th><th className="num">Internal Order</th><th className="num">Direct</th><th className="num">Total</th></tr></thead>
              <tbody>
                {statement.map((r) => (
                  <tr key={r.design_project_id ?? 'company'}>
                    <td>{r.project_name}</td>
                    <td className="num">{money(r.supplier_bills_total)}</td>
                    <td className="num">{money(r.internal_order_total)}</td>
                    <td className="num">{money(r.direct_expenses)}</td>
                    <td className="num font-medium">{money(r.total_expense)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Ledger (money out)">
        {ledgerQ.isLoading ? <LoadingBlock /> : !withBalance.length ? <EmptyState title="No Design Build transactions in this period" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Category</th><th>Project</th><th>Description</th><th>Reference</th><th className="num">Out</th><th className="num">Running total</th></tr></thead>
              <tbody>
                {withBalance.map((r) => (
                  <tr key={`${r.reference_type}-${r.reference_id}`}>
                    <td>{displayDate(r.txn_date)}</td>
                    <td><Badge tone="neutral">{r.category}</Badge></td>
                    <td>{r.project_name || <span className="text-ink-400">Company</span>}</td>
                    <td>{r.description}</td>
                    <td>{r.reference}</td>
                    <td className="num text-bad">{money(r.amount)}</td>
                    <td className="num font-medium">{money(r.balance)}</td>
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
