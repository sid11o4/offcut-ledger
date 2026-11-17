import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { buildTableDoc, saveDoc } from '../../lib/reportPdf'
import { money, pdfMoney } from '../../lib/format'
import { displayDate, today } from '../../lib/dates'

const FILTERS = [['all', 'All'], ['Material', 'Material'], ['Labour', 'Labour'], ['Return credit', 'Return credits']]

const daysOld = (d) => Math.max(0, Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86400000))

// Everything still owed, material and labour: approved bills not yet paid in full, and labour owed to
// contractors from their daily entries. Credit, and RTGS still waiting for the bank statement, count as unpaid.
export default function PendingPayables() {
  const [filter, setFilter] = useState('all')
  const q = useQuery({
    queryKey: ['pending_payables'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_payables')
      if (error) throw error
      return (data || []).map((r) => ({
        ...r, total: Number(r.total), paid: Number(r.paid), balance: Number(r.balance), awaiting_bank: Number(r.awaiting_bank),
      }))
    },
  })

  const rows = q.data || []
  const isLabour = (r) => r.kind === 'Labour'
  const shown = useMemo(
    () => rows
      .filter((r) => filter === 'all' || (filter === 'Return credit' ? r.kind === 'Return credit' : filter === 'Labour' ? r.kind === 'Labour' || r.kind === 'Material + labour' : r.kind === 'Material' || r.kind === 'Material + labour'))
      .sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date))),
    [rows, filter],
  )
  const sum = (xs) => xs.reduce((s, r) => s + r.balance, 0)
  const creditTotal = sum(rows.filter((r) => r.kind === 'Return credit'))
  const materialTotal = sum(rows.filter((r) => r.kind === 'Material'))
  const labourTotal = sum(rows.filter(isLabour))
  const mixedTotal = sum(rows.filter((r) => r.kind === 'Material + labour'))
  const total = sum(rows)
  const oldest = rows.length ? Math.max(...rows.map((r) => daysOld(r.doc_date))) : 0

  const byParty = useMemo(() => {
    const m = new Map()
    for (const r of shown) {
      const cur = m.get(r.party) || { party: r.party, count: 0, balance: 0 }
      cur.count += 1
      cur.balance += r.balance
      m.set(r.party, cur)
    }
    return [...m.values()].sort((a, b) => b.balance - a.balance)
  }, [shown])

  function downloadPdf() {
    const label = FILTERS.find(([k]) => k === filter)[1]
    const listed = sum(shown)
    const doc = buildTableDoc({
      title: 'Pending payables',
      subtitle: `${label} payables`,
      meta: [['As of', displayDate(today())], ['Items', String(shown.length)]],
      cards: [['Total payable', pdfMoney(total)], ['Material', pdfMoney(materialTotal + mixedTotal)], ['Labour', pdfMoney(labourTotal)]],
      sections: [
        {
          heading: 'By vendor / contractor',
          head: ['Vendor / contractor', 'Items', 'Balance'],
          body: byParty.map((p) => [p.party, String(p.count), pdfMoney(p.balance)]),
          foot: ['Total', '', pdfMoney(listed)],
          columnStyles: { 2: { halign: 'right' } },
        },
        {
          heading: 'Bills and entries',
          head: ['Date', 'Type', 'Vendor / contractor', 'Project', 'Reference', 'Total', 'Paid', 'Balance'],
          body: shown.map((r) => [
            displayDate(r.doc_date), r.kind, r.party, r.project_name || '—', r.ref || '—',
            pdfMoney(r.total), pdfMoney(r.paid), pdfMoney(r.balance),
          ]),
          foot: ['Total', '', '', '', '', '', '', pdfMoney(listed)],
          columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
        },
      ],
    })
    saveDoc(doc, `pending-payables-${filter}-${today()}.pdf`)
  }

  return (
    <div>
      <PageHeader
        title="Pending payables"
        subtitle="Everything still owed to vendors and labour. Credit, and RTGS / NEFT still waiting for the bank statement, count as unpaid."
        actions={<button className="btn-primary" disabled={!shown.length} onClick={downloadPdf}>Download PDF</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total payable" value={money(total)} sub={creditTotal ? `After ${money(-creditTotal)} of return credit` : `${rows.length} item${rows.length === 1 ? '' : 's'}`} tone={total ? 'bad' : 'neutral'} money />
        <StatCard label="Material" value={money(materialTotal + mixedTotal)} sub="Vendor bills" money />
        <StatCard label="Labour" value={money(labourTotal)} sub="Labour bills and contractors" money />
        <StatCard label="Oldest" value={`${oldest} days`} sub="Since the oldest bill or entry" />
      </div>

      {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load payables" hint={q.error.message} /> : (
        <>
          <Card className="mb-5">
            <div className="mb-3 flex flex-wrap gap-2">
              {FILTERS.map(([k, label]) => (
                <button key={k} className={filter === k ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            {!shown.length ? <EmptyState title="Nothing pending" hint="Approved bills and labour entries that are not fully paid appear here." /> : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Date</th><th>Type</th><th>Vendor / contractor</th><th>Project</th><th>Reference</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th className="num">Age</th></tr></thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={`${r.bill_id || r.party}-${i}`}>
                        <td className="tnum">{displayDate(r.doc_date)}</td>
                        <td><Badge tone={r.kind === 'Labour' ? 'warn' : r.kind === 'Return credit' ? 'ok' : 'neutral'}>{r.kind}</Badge></td>
                        <td>{r.party}</td>
                        <td>{r.project_name || '—'}</td>
                        <td>
                          {r.ref}
                          {r.awaiting_bank > 0 && <div className="text-[11px] text-ink-500">RTGS {money(r.awaiting_bank)} awaiting bank</div>}
                        </td>
                        <td className="num tnum">{money(r.total)}</td>
                        <td className="num tnum">{money(r.paid)}</td>
                        <td className="num tnum font-medium text-ink-950">{money(r.balance)}</td>
                        <td className="num tnum text-ink-500">{daysOld(r.doc_date)}d</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={7} className="font-medium">Total</td><td className="num tnum font-semibold">{money(sum(shown))}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </Card>

          {byParty.length > 0 && (
            <Card title="By vendor / contractor">
              <table className="table-base">
                <thead><tr><th>Vendor / contractor</th><th className="num">Items</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {byParty.map((p) => (
                    <tr key={p.party}><td>{p.party}</td><td className="num tnum">{p.count}</td><td className="num tnum font-medium text-ink-950">{money(p.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
