import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { buildTableDoc, saveDoc } from '../../lib/reportPdf'
import { money, pdfMoney } from '../../lib/format'
import { displayDate, today } from '../../lib/dates'

const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['matched', 'Matched']]

// Every payment marked RTGS/NEFT. A payment stays Pending until an uploaded bank statement line matches it
// at 95% or better; then it is Matched and counts as paid.
export default function RtgsPayments() {
  const toast = useToast()
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [filter, setFilter] = useState('all')
  const [matching, setMatching] = useState(false)

  const q = useQuery({
    queryKey: ['rtgs_payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bill_payments')
        .select('id, allocated_amount, utr_reference, confirmed, confirmed_amount, confirmed_at, created_at, remarks, supplier_bills(internal_bill_number, bill_date, status, supplier_text, suppliers(name), design_projects(name))')
        .eq('mode', 'rtgs_neft')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).filter((p) => p.supplier_bills?.status !== 'void')
    },
  })

  const rows = q.data || []
  const shown = useMemo(
    () => rows.filter((p) => filter === 'all' || (filter === 'pending' ? !p.confirmed : p.confirmed)),
    [rows, filter],
  )
  const pendingTotal = rows.filter((p) => !p.confirmed).reduce((s, p) => s + Number(p.allocated_amount), 0)
  const matchedTotal = rows.filter((p) => p.confirmed).reduce((s, p) => s + Number(p.allocated_amount), 0)
  const vendorOf = (p) => p.supplier_bills?.suppliers?.name || p.supplier_bills?.supplier_text || 'Vendor not recorded'

  async function matchNow() {
    setMatching(true)
    const { data, error } = await supabase.rpc('auto_match_bank_transactions')
    setMatching(false)
    if (error) return toast.error(error.message)
    toast.success(data ? `${data} payment${data === 1 ? '' : 's'} matched with the bank statement.` : 'No new payments matched the uploaded statements.')
    qc.invalidateQueries({ queryKey: ['rtgs_payments'] })
    qc.invalidateQueries({ queryKey: ['bank_unmatched'] })
  }

  function downloadPdf() {
    const label = FILTERS.find(([k]) => k === filter)[1]
    const total = shown.reduce((s, p) => s + Number(p.allocated_amount), 0)
    const doc = buildTableDoc({
      title: 'RTGS / NEFT payments',
      subtitle: `${label} payments`,
      meta: [['As of', displayDate(today())], ['Payments', String(shown.length)]],
      cards: [['Pending', pdfMoney(pendingTotal)], ['Matched', pdfMoney(matchedTotal)], ['Listed', pdfMoney(total)]],
      sections: [{
        heading: 'Payments',
        head: ['Date', 'Bill', 'Vendor / contractor', 'Project', 'UTR', 'Amount', 'Status'],
        body: shown.map((p) => [
          displayDate(p.created_at.slice(0, 10)),
          p.supplier_bills?.internal_bill_number || '—',
          vendorOf(p),
          p.supplier_bills?.design_projects?.name || '—',
          p.utr_reference || '—',
          pdfMoney(p.allocated_amount),
          p.confirmed ? `Matched ${displayDate(p.confirmed_at.slice(0, 10))}` : 'Pending',
        ]),
        foot: ['Total', '', '', '', '', pdfMoney(total), ''],
        columnStyles: { 5: { halign: 'right' } },
      }],
    })
    saveDoc(doc, `rtgs-neft-payments-${filter}-${today()}.pdf`)
  }

  return (
    <div>
      <PageHeader
        title="RTGS / NEFT payments"
        subtitle="Every payment marked RTGS/NEFT. It stays Pending until an uploaded bank statement line matches it at 95% or better."
        actions={
          <>
            <Link className="btn-secondary" to="/accounts/bank">Upload bank statement</Link>
            {hasPermission('bank_reconciliation') && (
              <button className="btn-secondary" disabled={matching} onClick={matchNow}>{matching ? 'Matching…' : 'Match with statements'}</button>
            )}
            <button className="btn-primary" disabled={!shown.length} onClick={downloadPdf}>Download PDF</button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Pending" value={money(pendingTotal)} sub={`${rows.filter((p) => !p.confirmed).length} payments`} tone={pendingTotal ? 'warn' : 'neutral'} money />
        <StatCard label="Matched" value={money(matchedTotal)} sub={`${rows.filter((p) => p.confirmed).length} payments`} tone="ok" money />
        <StatCard label="All RTGS / NEFT" value={money(pendingTotal + matchedTotal)} sub={`${rows.length} payments`} money />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load payments" hint={q.error.message} /> : !shown.length ? (
          <EmptyState title="No RTGS / NEFT payments here" hint="Payments marked RTGS/NEFT on a bill appear in this list." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Bill</th><th>Vendor / contractor</th><th>Project</th><th>UTR</th><th className="num">Amount</th><th className="num">Bank debit</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{displayDate(p.created_at.slice(0, 10))}</td>
                    <td>{p.supplier_bills?.internal_bill_number || '—'}</td>
                    <td className="font-medium">{vendorOf(p)}</td>
                    <td>{p.supplier_bills?.design_projects?.name || '—'}</td>
                    <td>{p.utr_reference || '—'}</td>
                    <td className="num">{money(p.allocated_amount)}</td>
                    <td className="num">{p.confirmed ? money(p.confirmed_amount) : '—'}</td>
                    <td>{p.confirmed ? <Badge tone="ok">Matched {displayDate(p.confirmed_at.slice(0, 10))}</Badge> : <Badge tone="warn">Pending</Badge>}</td>
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
