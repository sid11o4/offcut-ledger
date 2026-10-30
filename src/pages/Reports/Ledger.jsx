import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money } from '../../lib/format'
import Papa from 'papaparse'

// Every money-in and money-out event in one chronological list (owner's request: "a proper
// ledger"), unlike the existing Income/Expense Statement which only ever showed category
// totals. Backed by income_expense_ledger() (0040): issued bills (money in, same revenue
// recognition point Factory already uses), plus expenses and supplier payments (money out).
// A running balance reads top (oldest) to bottom (most recent), the normal ledger direction --
// the RPC itself returns newest-first for other callers, so it's re-sorted here.
const REF_ROUTE = {
  bill: (id) => `/billing/${id}`,
}

export default function Ledger() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [filter, setFilter] = useState('all')

  const q = useQuery({
    queryKey: ['income_expense_ledger', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('income_expense_ledger', { p_start: start, p_end: end })
      if (error) throw error
      return data || []
    },
  })

  const rows = q.data || []
  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0)
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0)

  // Oldest first for a running balance, stable within a day by insertion order from the RPC.
  const ascending = [...rows].reverse()
  const withBalance = ascending.reduce((acc, r) => {
    const prevBalance = acc.length ? acc[acc.length - 1].balance : 0
    const balance = prevBalance + (r.direction === 'in' ? Number(r.amount) : -Number(r.amount))
    acc.push({ ...r, balance })
    return acc
  }, [])
  const visible = (filter === 'all' ? withBalance : withBalance.filter((r) => r.direction === filter)).slice().reverse()

  function exportCsv() {
    const csv = Papa.unparse(withBalance.map((r) => ({
      Date: displayDate(r.txn_date),
      Direction: r.direction === 'in' ? 'In' : 'Out',
      Category: r.category,
      Description: r.description,
      Reference: r.reference,
      Amount: r.amount,
      'Running Balance': r.balance,
    })))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `formgrid-ledger-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Every money-in and money-out transaction for the period, in order, with a running balance."
        actions={rows.length > 0 && <button className="btn-secondary text-xs" onClick={exportCsv}>Export CSV</button>}
      />

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Money in" value={money(totalIn)} tone="ok" />
        <StatCard label="Money out" value={money(totalOut)} tone="bad" />
        <StatCard label="Net" value={money(totalIn - totalOut)} tone={totalIn - totalOut >= 0 ? 'ok' : 'bad'} />
      </div>

      <div className="flex gap-1 mb-3 border-b border-ink-200">
        {[['all', 'All'], ['in', 'Money in'], ['out', 'Money out']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${filter === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        {q.isLoading ? <LoadingBlock /> : !visible.length ? <EmptyState title="No transactions in this period" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead>
                <tr><th>Date</th><th>Category</th><th>Description</th><th>Reference</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const route = REF_ROUTE[r.reference_type]?.(r.reference_id)
                  return (
                    <tr key={`${r.reference_type}-${r.reference_id}-${i}`}>
                      <td>{displayDate(r.txn_date)}</td>
                      <td><Badge tone={r.direction === 'in' ? 'ok' : 'neutral'}>{r.category}</Badge></td>
                      <td>{r.description}</td>
                      <td>{route ? <Link to={route} className="text-brand-700 hover:underline">{r.reference}</Link> : r.reference}</td>
                      <td className="num text-ok">{r.direction === 'in' ? money(r.amount) : ''}</td>
                      <td className="num text-bad">{r.direction === 'out' ? money(r.amount) : ''}</td>
                      <td className="num font-medium">{money(r.balance)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
