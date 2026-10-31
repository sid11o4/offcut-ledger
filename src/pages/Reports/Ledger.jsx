import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import BankStatement from '../../components/BankStatement'
import { money } from '../../lib/format'

const FAR_PAST = '2000-01-01'

// Every money-in and money-out event for the period as a bank-style statement, backed by
// income_expense_ledger() (0040): issued bills (money in) plus expenses and supplier payments (money out).
// The opening balance is everything before the period, so the running balance is the true balance.
const REF_ROUTE = {
  bill: (id) => `/billing/${id}`,
}

// The day before an ISO date, built from local parts so the UTC offset never shifts it.
function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Ledger() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])

  const q = useQuery({
    queryKey: ['income_expense_ledger', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('income_expense_ledger', { p_start: start, p_end: end })
      if (error) throw error
      return data || []
    },
  })

  const priorQ = useQuery({
    queryKey: ['income_expense_ledger_prior', start],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('income_expense_ledger', { p_start: FAR_PAST, p_end: dayBefore(start) })
      if (error) throw error
      return (data || []).reduce((s, r) => s + (r.direction === 'in' ? Number(r.amount) : -Number(r.amount)), 0)
    },
  })

  const rows = q.data || []
  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0)
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0)

  // Oldest first, as a statement reads. The RPC returns newest first.
  const statementRows = [...rows].reverse().map((r, i) => ({
    key: `${r.reference_type}-${r.reference_id}-${i}`,
    date: r.txn_date,
    category: r.category,
    description: r.description,
    reference: r.reference,
    direction: r.direction,
    amount: r.amount,
    href: REF_ROUTE[r.reference_type]?.(r.reference_id),
  }))

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Every money-in and money-out transaction for the period, as an account statement with the balance after each line."
      />

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Money in" value={money(totalIn)} tone="ok" />
        <StatCard label="Money out" value={money(totalOut)} tone="bad" />
        <StatCard label="Net" value={money(totalIn - totalOut)} tone={totalIn - totalOut >= 0 ? 'ok' : 'bad'} />
      </div>

      <Card>
        <BankStatement
          rows={statementRows}
          opening={priorQ.data || 0}
          loading={q.isLoading || priorQ.isLoading}
          exportName={`formgrid-ledger-${start}-to-${end}`}
        />
      </Card>
    </div>
  )
}
