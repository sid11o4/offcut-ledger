import Papa from 'papaparse'
import { Link } from 'react-router-dom'
import { EmptyState, LoadingBlock } from './ui'
import { displayDate } from '../lib/dates'
import { money } from '../lib/format'

// A bank-style account statement, shared by every ledger in the app. Oldest entry first, an opening
// balance above the first line, Debit (money out) and Credit (money in) columns, a running balance,
// and a closing balance below the last line. Callers pass rows already in date order.
//
// rows: [{ key, date, category, description, reference, direction: 'in' | 'out', amount, href? }]
// opening: the balance brought forward at the start of the period.
export default function BankStatement({ rows, opening = 0, loading = false, exportName = 'statement' }) {
  let running = Number(opening)
  const lines = rows.map((r) => {
    const amount = Number(r.amount)
    const credit = r.direction === 'in' ? amount : 0
    const debit = r.direction === 'out' ? amount : 0
    running += credit - debit
    return { ...r, credit, debit, balance: running }
  })
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const closing = running

  function exportCsv() {
    const csv = Papa.unparse([
      { Date: '', Details: 'Opening balance', Reference: '', Debit: '', Credit: '', Balance: Number(opening) },
      ...lines.map((l) => ({
        Date: displayDate(l.date),
        Details: l.category ? `${l.category}${l.description ? ` — ${l.description}` : ''}` : (l.description || ''),
        Reference: l.reference || '',
        Debit: l.debit || '',
        Credit: l.credit || '',
        Balance: l.balance,
      })),
      { Date: '', Details: 'Closing balance', Reference: '', Debit: totalDebit, Credit: totalCredit, Balance: closing },
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingBlock />

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className="card p-3"><div className="text-xs text-ink-500">Opening balance</div><div className="num font-medium">{money(opening)}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-500">Total credits (in)</div><div className="num font-medium text-ok">{money(totalCredit)}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-500">Total debits (out)</div><div className="num font-medium text-bad">{money(totalDebit)}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-500">Closing balance</div><div className="num font-medium">{money(closing)}</div></div>
      </div>

      <div className="flex justify-end gap-2 mb-2 print:hidden">
        <button className="btn-secondary text-xs" onClick={() => window.print()}>Print</button>
        {lines.length > 0 && <button className="btn-secondary text-xs" onClick={exportCsv}>Export CSV</button>}
      </div>

      {!lines.length ? <EmptyState title="No transactions in this period" /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th><th>Details</th><th>Reference</th>
                <th className="num">Debit (out)</th><th className="num">Credit (in)</th><th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-ink-50">
                <td colSpan={5} className="font-medium">Opening balance</td>
                <td className="num font-medium">{money(opening)}</td>
              </tr>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>{displayDate(l.date)}</td>
                  <td>
                    <div>{l.category || l.description}</div>
                    {l.category && l.description && <div className="text-xs text-ink-500">{l.description}</div>}
                  </td>
                  <td>{l.href ? <Link to={l.href} className="text-brand-700 hover:underline">{l.reference}</Link> : l.reference}</td>
                  <td className="num text-bad">{l.debit ? money(l.debit) : ''}</td>
                  <td className="num text-ok">{l.credit ? money(l.credit) : ''}</td>
                  <td className="num font-medium">{money(l.balance)}</td>
                </tr>
              ))}
              <tr className="bg-ink-50">
                <td colSpan={3} className="font-medium">Closing balance</td>
                <td className="num font-medium text-bad">{money(totalDebit)}</td>
                <td className="num font-medium text-ok">{money(totalCredit)}</td>
                <td className="num font-medium">{money(closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
