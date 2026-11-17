import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import { loadVendorDashboard } from '../../lib/vendorData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// The dashboard for one vendor or contractor: everything they have sold, returned, invoiced and been paid.
export default function VendorDashboard() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['vendor_dashboard', id], queryFn: () => loadVendorDashboard(id) })
  const d = q.data

  if (q.isLoading) return <LoadingBlock />
  if (q.error) return <EmptyState title="Could not load this vendor" hint={q.error.message} />
  if (!d) return null

  const t = d.totals
  return (
    <div>
      <PageHeader
        title={d.supplier?.name || 'Vendor'}
        subtitle={d.supplier?.gstin ? `GSTIN ${d.supplier.gstin}` : 'Bills, invoices, payments, returns and stock from this vendor'}
        actions={<Link className="btn-secondary" to="/design-build/suppliers">All vendors</Link>}
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Card><StatCard label="Billed" value={money(t.billed)} money /></Card>
        <Card><StatCard label="Paid" value={money(t.paid)} money /></Card>
        <Card><StatCard label="Round off / waived" value={money(t.waived)} money /></Card>
        <Card><StatCard label="Return credit" value={money(t.returned)} sub={t.creditPending > 0 ? `${money(t.creditPending)} not yet settled` : 'All settled'} tone={t.creditPending > 0 ? 'ok' : 'neutral'} money /></Card>
        <Card><StatCard label={t.balance >= 0 ? 'We owe' : 'Vendor owes us'} value={money(Math.abs(t.balance))} money /></Card>
      </div>
      {d.gstOpen > 0 && (
        <div className="mb-5 text-sm text-ink-700">{d.gstOpen} GST invoice follow-up{d.gstOpen === 1 ? '' : 's'} open with this vendor.</div>
      )}

      <Card title={`Bills (${d.bills.length})`} className="mb-5">
        {!d.bills.length ? <EmptyState title="No bills from this vendor" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Bill no.</th><th>Date</th><th>Type</th><th>Project</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Owed</th><th>GST</th></tr></thead>
              <tbody>
                {d.bills.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono text-xs">{b.internal_bill_number}</td>
                    <td>{displayDate(b.bill_date)}</td>
                    <td>{b.bill_source === 'vendor' ? 'Vendor bill' : 'FORMGRID bill'}</td>
                    <td>{b.design_projects?.name || 'Factory'}</td>
                    <td className="capitalize">{b.status === 'void' ? 'Voided' : b.status === 'applied' ? 'Paid vendor credit' : b.status.replace('_', ' ')}</td>
                    <td className="num">{b.status === 'void' ? '—' : money(b.grand_total)}</td>
                    <td className="num">{money(b.paid)}</td>
                    <td className="num font-medium">{b.status === 'void' || b.status === 'applied' ? '—' : money(b.owed)}</td>
                    <td className="capitalize">{b.gst || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Invoices and tax invoices (${d.documents.length})`} className="mb-5">
        {!d.documents.length ? <EmptyState title="No invoices attached" hint="Attach vendor bills, GST invoices and other papers from a bill's details." /> : (
          <table className="table-base">
            <thead><tr><th>Document</th><th>Kind</th><th>Bill</th><th>Added</th><th /></tr></thead>
            <tbody>
              {d.documents.map((a) => (
                <tr key={a.id}>
                  <td className="truncate max-w-xs">{a.file_name}</td>
                  <td className="capitalize">{(a.kind || 'other').replace('_', ' ')}</td>
                  <td className="font-mono text-xs">{a.billNumber}</td>
                  <td>{displayDate(a.created_at?.slice(0, 10))}</td>
                  <td className="text-right"><OpenDocument path={a.file_path} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Returns (${d.returns.length})`} className="mb-5">
        {!d.returns.length ? <EmptyState title="No returns to this vendor" /> : (
          <table className="table-base">
            <thead><tr><th>Slip</th><th>Date</th><th>Items</th><th>Slip</th><th>Credit</th><th className="num">Stock value</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {d.returns.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.slip_number}</td>
                  <td>{displayDate(r.return_date)}</td>
                  <td className="text-sm">{r.items.map((i) => `${i.inventory_items?.name} ${qty(i.quantity)} ${i.inventory_items?.units?.code || ''}`).join(', ') || '—'}</td>
                  <td>{r.follow_up_status === 'filed' ? `Filed ${r.slip_filed_reference || ''}` : 'To file'}</td>
                  <td className="text-sm">
                    {r.credit_status === 'awaiting_credit' && 'Awaiting credit note'}
                    {r.credit_status === 'credit_received' && `Credit note ${r.credit_note_number || ''}`}
                    {r.credit_status === 'settled' && (r.credit_settled_how === 'refunded' ? `Refunded ${displayDate(r.credit_settled_on)}` : 'Adjusted against a bill')}
                  </td>
                  <td className="num">{money(r.total_amount)}</td>
                  <td className="num font-medium">{money(r.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <Card title="Stock on hand from this vendor">
          {!d.stock.length ? <EmptyState title="No stock from this vendor is on hand" /> : (
            <table className="table-base">
              <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">Value</th></tr></thead>
              <tbody>
                {d.stock.map((s) => (
                  <tr key={s.name}>
                    <td>
                      {s.name}
                      <div className="text-xs text-ink-500">{s.locations.map((l) => `${l.name} ${qty(l.quantity)}`).join(' · ')}</div>
                    </td>
                    <td className="num">{qty(s.quantity)} {s.unit}</td>
                    <td className="num font-medium">{money(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={`Purchases into stock (${d.purchases.length})`}>
          {!d.purchases.length ? <EmptyState title="No purchases into stock" hint="Only vendor bills that were approved with matched material add stock." /> : (
            <div className="max-h-96 overflow-y-auto">
              <table className="table-base">
                <thead><tr><th>Date</th><th>Material</th><th>Bill</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
                <tbody>
                  {d.purchases.map((p) => (
                    <tr key={p.id}>
                      <td>{displayDate(p.txn_date)}</td>
                      <td>{p.inventory_items?.name}</td>
                      <td className="font-mono text-xs">{p.billNumber}</td>
                      <td className="num">{qty(p.quantity)}</td>
                      <td className="num">{money(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Ledger: every credit and debit (${d.ledger.length})`}>
        {!d.ledger.length ? <EmptyState title="No transactions yet" /> : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Project / detail</th><th className="num">Credit (bill)</th><th className="num">Debit (paid / returned)</th><th className="num">Balance owed</th></tr></thead>
              <tbody>
                {d.ledger.map((e) => (
                  <tr key={e.key}>
                    <td>{displayDate(e.date)}</td>
                    <td>{e.type}</td>
                    <td className="font-mono text-xs">{e.reference}</td>
                    <td className="text-sm">{e.description}</td>
                    <td className="num">{e.credit ? money(e.credit) : ''}</td>
                    <td className="num">{e.debit ? money(e.debit) : ''}</td>
                    <td className="num font-medium">{money(e.balance)}</td>
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

// Opens a stored invoice or bill document in a new tab.
function OpenDocument({ path }) {
  const [busy, setBusy] = useState(false)
  async function open() {
    setBusy(true)
    const { data } = await supabase.storage.from('scan-uploads').createSignedUrl(path, 600)
    setBusy(false)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }
  return <button type="button" className="btn-ghost text-xs px-2" onClick={open} disabled={busy}>{busy ? 'Opening…' : 'Open'}</button>
}
