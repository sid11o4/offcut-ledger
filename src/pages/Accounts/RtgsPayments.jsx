import { matchBankPayments, matchSummary } from '../../lib/bankMatch'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock, Field, Input } from '../../components/ui'
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
  const [filter, setFilter] = useState('pending')
  const [matching, setMatching] = useState(false)

  const q = useQuery({
    queryKey: ['rtgs_payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bill_payments')
        .select('id, allocated_amount, utr_reference, confirmed, confirmed_amount, confirmed_at, bank_transaction_id, created_at, remarks, supplier_bills(internal_bill_number, bill_date, status, supplier_text, suppliers(name), design_projects(name))')
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

  // A payment the bank statement does not show (or that has no statement yet) can be confirmed by hand, with a reason
  // and, when known, its UTR. A statement uploaded later is linked to it by that UTR.
  const [confirming, setConfirming] = useState(null)
  const [form, setForm] = useState({ reason: '', utr: '' })
  function startConfirm(p) { setConfirming(p); setForm({ reason: '', utr: p.utr_reference || '' }) }
  async function confirmByHand(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('confirm_payment_without_statement', { p_payment_id: confirming.id, p_reason: form.reason.trim(), p_utr: form.utr.trim() || null })
    if (error) return toast.error(error.message)
    toast.success(form.utr.trim() ? 'Payment confirmed. A statement with this UTR will link to it.' : 'Payment confirmed without a bank statement.')
    setConfirming(null)
    refreshLists()
  }
  async function editUtr(p) {
    const utr = window.prompt(`UTR / reference for ${money(p.allocated_amount)} to ${vendorOf(p)}. A bank statement line with this UTR will be linked to it.`, p.utr_reference || '')
    if (utr === null) return
    const { error } = await supabase.rpc('set_payment_utr', { p_payment_id: p.id, p_utr: utr })
    if (error) return toast.error(error.message)
    toast.success('UTR saved.')
    refreshLists()
  }
  async function reverse(p) {
    const reason = window.prompt(`Reverse the ${money(p.allocated_amount)} payment to ${vendorOf(p)}? It goes back to payables as owed${p.bank_transaction_id ? ', and its bank statement line becomes unmatched' : ''}. Why?`)
    if (!reason?.trim()) return
    const { error } = await supabase.rpc('reverse_supplier_payment', { p_payment_id: p.id, p_reason: reason.trim() })
    if (error) return toast.error(error.message)
    toast.success('Payment reversed. The amount is owed again.')
    refreshLists()
  }
  function refreshLists() {
    for (const key of ['rtgs_payments', 'pending_payables', 'vendor_dashboard', 'bank_unmatched']) qc.invalidateQueries({ queryKey: [key] })
  }

  async function matchNow() {
    setMatching(true)
    let res
    try { res = await matchBankPayments() } catch (e) { setMatching(false); return toast.error(e.message) }
    setMatching(false)
    toast.success(matchSummary(res))
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

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={confirmByHand} className="card p-5 w-full max-w-md space-y-3">
            <div className="text-sm font-semibold text-ink-950">Mark as paid without a bank statement</div>
            <p className="text-xs text-ink-500">{money(confirming.allocated_amount)} to {vendorOf(confirming)}. It counts as paid now; a statement uploaded later is linked to it by the UTR.</p>
            <Field label="UTR / reference (optional, enables the match)"><Input value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value })} /></Field>
            <Field label="Why is it confirmed without a statement?"><Input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn-primary flex-1">Mark paid</button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

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
              <thead><tr><th>Date</th><th>Bill</th><th>Vendor / contractor</th><th>Project</th><th>UTR</th><th className="num">Amount</th><th className="num">Bank debit</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{displayDate(p.created_at.slice(0, 10))}</td>
                    <td>{p.supplier_bills?.internal_bill_number || '—'}</td>
                    <td className="font-medium">{vendorOf(p)}</td>
                    <td>{p.supplier_bills?.design_projects?.name || '—'}</td>
                    <td>
                      {p.utr_reference || '—'}
                      {!p.bank_transaction_id && <button className="btn-ghost text-xs px-1.5 ml-1" onClick={() => editUtr(p)}>{p.utr_reference ? 'Edit' : 'Add'}</button>}
                    </td>
                    <td className="num">{money(p.allocated_amount)}</td>
                    <td className="num">{p.confirmed ? money(p.confirmed_amount) : '—'}</td>
                    <td>{p.confirmed ? <Badge tone="ok">{p.bank_transaction_id || p.remarks == null ? 'Matched' : (/without bank statement/i.test(p.remarks) ? 'Confirmed, no statement' : 'Matched')} {displayDate(p.confirmed_at.slice(0, 10))}</Badge> : <Badge tone="warn">Pending</Badge>}</td>
                    <td className="text-right whitespace-nowrap">
                      {!p.confirmed && hasPermission('bank_reconciliation') && <button className="btn-ghost text-xs px-2" onClick={() => startConfirm(p)}>Mark paid</button>}
                      <button className="btn-ghost text-xs px-2" onClick={() => reverse(p)}>Reverse</button>
                    </td>
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
