import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import BankStatement from '../../components/BankStatement'
import { money } from '../../lib/format'
import { displayDate } from '../../lib/dates'

const FAR_PAST = '2000-01-01'

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

  // Everything before the period, so the statement opens on the true balance brought forward.
  const priorQ = useQuery({
    queryKey: ['db_ledger_prior', start],
    queryFn: async () => {
      // The day before the period, from local parts so the UTC offset never shifts it.
      const day = new Date(`${start}T00:00:00`)
      day.setDate(day.getDate() - 1)
      const pad = (n) => String(n).padStart(2, '0')
      const before = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
      const { data, error } = await supabase.rpc('design_build_ledger', { p_start: FAR_PAST, p_end: before })
      if (error) throw error
      return (data || []).reduce((s, r) => s + Number(r.amount), 0)
    },
  })

  const statement = statementQ.data || []
  const ledger = ledgerQ.data || []
  const totalBills = statement.reduce((s, r) => s + Number(r.supplier_bills_total), 0)
  const totalInternal = statement.reduce((s, r) => s + Number(r.internal_order_total), 0)
  const totalDirect = statement.reduce((s, r) => s + Number(r.direct_expenses || 0), 0)
  const totalExpense = totalBills + totalInternal + totalDirect

  // Oldest first, as a bank statement reads. The ledger RPC returns newest first.
  const statementRows = [...ledger].reverse().map((r) => ({
    key: `${r.reference_type}-${r.reference_id}`,
    date: r.txn_date,
    category: r.category,
    description: r.project_name ? `${r.project_name}${r.description ? ` — ${r.description}` : ''}` : (r.description || 'Company'),
    reference: r.reference,
    direction: 'out',
    amount: r.amount,
  }))

  return (
    <div>
      <PageHeader
        title="Design Build Ledger & Statement"
        subtitle="Design Build's own bank-style statement: money out for supplier payments, Internal Order job-work and direct expenses, with the balance after each line."
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

      <Card title="Account statement">
        <BankStatement
          rows={statementRows}
          opening={-(priorQ.data || 0)}
          loading={ledgerQ.isLoading || priorQ.isLoading}
          exportName={`design-build-statement-${start}-to-${end}`}
          pdfTitle="Account statement"
          subtitle="Design Build"
          period={`${displayDate(start)} – ${displayDate(end)}`}
        />
      </Card>
    </div>
  )
}
