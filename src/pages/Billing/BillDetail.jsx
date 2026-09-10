import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { useAppSettings } from '../../lib/queries'
import { computeGst } from '../../lib/gst'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'
import { generateBillPdf } from '../../lib/pdf'

export default function BillDetail() {
  const { id } = useParams()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const settingsQ = useAppSettings()

  const billQ = useQuery({
    queryKey: ['bill', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('bills').select('*, clients(*), projects(*)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const itemsQ = useQuery({
    queryKey: ['bill-items', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('bill_items').select('*, job_work_services(name), units(name,code)').eq('bill_id', id).order('entry_date')
      if (error) throw error
      return data
    },
  })

  const bill = billQ.data
  const items = itemsQ.data || []

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['bill', id] })
    qc.invalidateQueries({ queryKey: ['bills'] })
  }

  async function cancelBill() {
    const reason = window.prompt('Reason for cancelling this bill:')
    if (!reason) return
    const ok = await confirm('Cancel this bill?', { detail: 'All its job-work entries will return to unbilled status.', confirmLabel: 'Cancel bill' })
    if (!ok) return
    const { error } = await supabase.rpc('cancel_bill', { p_bill_id: id, p_reason: reason })
    if (error) toast.error(error.message)
    else { toast.success('Bill cancelled.'); invalidate() }
  }

  async function setPaymentStatus(status) {
    const { error } = await supabase.from('bills').update({ payment_status: status }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Payment status updated.'); invalidate() }
  }

  function downloadPdf() {
    generateBillPdf({
      settings: settingsQ.data, bill, client: bill.clients, project: bill.projects,
      items: items.map((it) => ({ entry_date: it.entry_date, service_name: it.job_work_services?.name, quantity: it.quantity, unit_name: it.units?.name, amount: it.amount })),
    })
  }

  if (billQ.isLoading) return <LoadingBlock />
  if (!bill) return <EmptyState title="Bill not found" />

  return (
    <div>
      <PageHeader
        title={bill.bill_number}
        subtitle={`${bill.clients?.name} · ${bill.projects?.name}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={bill.status} />
            <button className="btn-secondary" onClick={downloadPdf}>Download PDF</button>
            {hasPermission('bill_cancel') && bill.status !== 'cancelled' && (
              <button className="btn-danger" onClick={cancelBill}>Cancel Bill</button>
            )}
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-ink-500 text-xs">Bill Date</div>{displayDate(bill.bill_date)}</div>
          <div><div className="text-ink-500 text-xs">Period</div>{bill.billing_period_start ? `${displayDate(bill.billing_period_start)} – ${displayDate(bill.billing_period_end)}` : '—'}</div>
          <div>
            <div className="text-ink-500 text-xs">Payment Status</div>
            {hasPermission('billing') && bill.status !== 'cancelled' ? (
              <select className="field-input py-1 mt-0.5" value={bill.payment_status} onChange={(e) => setPaymentStatus(e.target.value)}>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            ) : <StatusBadge status={bill.payment_status} />}
          </div>
          <div><div className="text-ink-500 text-xs">Grand Total</div><span className="font-semibold">{money(bill.grand_total)}</span></div>
        </div>
        {bill.status === 'cancelled' && bill.cancel_reason && (
          <div className="mt-3 text-sm text-bad bg-red-50 border border-red-200 rounded-md px-3 py-2">Cancelled: {bill.cancel_reason}</div>
        )}
      </Card>

      <Card title="Line Items">
        {itemsQ.isLoading ? <LoadingBlock /> : !items.length ? <EmptyState title="No items" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Job Work</th><th>Qty</th><th>Amount</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{displayDate(it.entry_date)}</td>
                    <td>{it.job_work_services?.name}</td>
                    <td>{qty(it.quantity)} {it.units?.code}</td>
                    <td className="font-medium">{money(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <div className="w-72 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(bill.subtotal)}</span></div>
            {(() => {
              const g = computeGst(bill.subtotal, bill.tax_percent, bill.gst_treatment || 'full')
              if (g.effectivePct > 0) {
                return (
                  <>
                    <div className="flex justify-between"><span>CGST ({g.halfPct}%)</span><span>{money(g.cgst)}</span></div>
                    <div className="flex justify-between"><span>SGST ({g.halfPct}%)</span><span>{money(g.sgst)}</span></div>
                    {g.note && <div className="text-xs text-ink-400">{g.note}</div>}
                  </>
                )
              }
              return Number(bill.tax_percent) > 0
                ? <div className="flex justify-between text-ink-500"><span>GST</span><span>Waived</span></div>
                : null
            })()}
            <div className="flex justify-between"><span>Adjustments</span><span>{money(bill.adjustments)}</span></div>
            <div className="flex justify-between font-semibold border-t border-ink-200 pt-1"><span>Grand Total</span><span>{money(bill.grand_total)}</span></div>
          </div>
        </div>
      </Card>
    </div>
  )
}
