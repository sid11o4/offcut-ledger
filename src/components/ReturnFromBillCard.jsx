import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { Card, Field, Input, Select, EmptyState } from './ui'
import { invalidateInventory } from '../lib/queries'
import { displayDate, today } from '../lib/dates'
import { money, qty } from '../lib/format'

// Return items by picking them from a vendor bill's own lines, not from what inventory shows. Stock goes out only
// for what is actually in stock; an item already used, or consumed directly, has no stock to take, and the credit
// is still at the bill's rate.
export default function ReturnFromBillCard({ suppliers }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [supplierId, setSupplierId] = useState('')
  const [billId, setBillId] = useState('')
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const [qtys, setQtys] = useState({})
  const [saving, setSaving] = useState(false)

  const billsQ = useQuery({
    queryKey: ['return_bills', supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bills')
        .select('id, internal_bill_number, bill_date, grand_total, design_projects(name)')
        .eq('supplier_id', supplierId).eq('bill_source', 'vendor').eq('status', 'approved').order('bill_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
  const linesQ = useQuery({
    queryKey: ['return_bill_lines', billId],
    enabled: !!billId,
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bill_items')
        .select('id, description, unit_text, quantity, returned_qty, rate_inclusive, total_amount')
        .eq('bill_id', billId).eq('item_type', 'material').eq('pays_vendor_credit', false).order('sort_order')
      if (error) throw error
      return data || []
    },
  })
  const lines = linesQ.data || []
  const left = (l) => Number(l.quantity) - Number(l.returned_qty || 0)
  const chosen = lines.filter((l) => Number(qtys[l.id]) > 0)
  const total = chosen.reduce((s, l) => s + Number(qtys[l.id]) * Number(l.rate_inclusive), 0)

  async function submit(e) {
    e.preventDefault()
    if (!chosen.length) return toast.error('Enter a quantity for at least one line.')
    setSaving(true)
    const { error } = await supabase.rpc('create_supplier_return_from_bill', {
      p_bill_id: billId, p_return_date: date, p_reason: reason || null,
      p_lines: chosen.map((l) => ({ bill_item_id: l.id, quantity: Number(qtys[l.id]) })),
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Return recorded from the bill. The slip is waiting to be filed.')
    setQtys({}); setReason(''); setBillId('')
    for (const key of ['supplier_return_slips', 'return_bill_lines', 'pending_payables', 'vendor_dashboard']) qc.invalidateQueries({ queryKey: [key] })
    invalidateInventory(qc)
  }

  return (
    <Card title="Return items from a vendor bill" className="mb-5">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-ink-500">Pick the bill and the lines being returned. Stock is taken out only where it is still in stock; the credit is at the bill's rate.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setBillId(''); setQtys({}) }}>
              <option value="">Choose…</option>
              {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Bill">
            <Select value={billId} disabled={!supplierId} onChange={(e) => { setBillId(e.target.value); setQtys({}) }}>
              <option value="">{supplierId ? (billsQ.data?.length ? 'Choose…' : 'No approved bill') : 'Choose the supplier first'}</option>
              {(billsQ.data || []).map((b) => <option key={b.id} value={b.id}>{b.internal_bill_number} · {displayDate(b.bill_date)} · {money(b.grand_total)}{b.design_projects?.name ? ` · ${b.design_projects.name}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Return date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        {billId && (linesQ.isLoading ? <p className="text-sm text-ink-500">Loading the bill's lines…</p> : !lines.length ? <EmptyState title="This bill has no material lines to return" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Item on the bill</th><th className="num">Billed</th><th className="num">Left to return</th><th className="num">Rate</th><th className="num w-32">Return qty</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="num">{qty(l.quantity)} {l.unit_text || ''}</td>
                    <td className="num">{qty(left(l))}</td>
                    <td className="num">{money(l.rate_inclusive)}</td>
                    <td className="num"><Input type="number" min="0" max={left(l)} step="any" disabled={left(l) <= 0} value={qtys[l.id] ?? ''} onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-600">Credit owed back: <span className="tnum font-semibold text-ink-950">{money(total)}</span></span>
          <button type="submit" className="btn-primary" disabled={saving || !chosen.length}>{saving ? 'Saving…' : 'Record return'}</button>
        </div>
      </form>
    </Card>
  )
}
