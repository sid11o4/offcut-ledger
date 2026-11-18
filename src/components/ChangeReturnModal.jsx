import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { Field, Input, Select } from './ui'
import { useInventoryItems, invalidateInventory } from '../lib/queries'
import { qty } from '../lib/format'

// Change the items of a return. A return made from a bill is changed on the bill's lines; any other return on the items
// and quantities it lists. The old stock movement is taken back and the new items are applied.
export default function ChangeReturnModal({ slip, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const fromBill = !!slip.bill_id
  const current = slip.supplier_return_slip_items || []
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  // bill returns: quantity per bill line; other returns: rows of { item_id, quantity }
  const [billQty, setBillQty] = useState(() => Object.fromEntries(current.filter((i) => i.bill_item_id).map((i) => [i.bill_item_id, String(i.quantity)])))
  const [rows, setRows] = useState(() => current.map((i) => ({ item_id: i.item_id, quantity: String(i.quantity) })))

  const linesQ = useQuery({
    queryKey: ['return_bill_lines_change', slip.bill_id],
    enabled: fromBill,
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bill_items')
        .select('id, description, unit_text, quantity, returned_qty, rate_inclusive')
        .eq('bill_id', slip.bill_id).eq('item_type', 'material').eq('pays_vendor_credit', false).order('sort_order')
      if (error) throw error
      return data || []
    },
  })
  const returnableQ = useQuery({
    queryKey: ['returnable_items_change', slip.supplier_id, slip.location_id],
    enabled: !fromBill && !!slip.supplier_id && !!slip.location_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('returnable_items', { p_supplier_id: slip.supplier_id, p_location_id: slip.location_id })
      if (error) throw error
      return data || []
    },
  })

  // What this slip already returned counts as available again once its old movement is taken back.
  const mine = new Map(current.map((i) => [fromBill ? i.bill_item_id : i.item_id, Number(i.quantity)]))
  const billLeft = (l) => Number(l.quantity) - Number(l.returned_qty || 0) + (mine.get(l.id) || 0)
  const stock = new Map((returnableQ.data || []).map((r) => [r.item_id, Number(r.quantity) + (mine.get(r.item_id) || 0)]))
  const nameOf = (id) => (itemsQ.data || []).find((i) => i.id === id)?.name || 'Item'
  const options = [...new Set([...stock.keys(), ...current.map((i) => i.item_id).filter(Boolean)])]

  async function submit(e) {
    e.preventDefault()
    const items = fromBill
      ? Object.entries(billQty).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ bill_item_id: id, quantity: Number(q) }))
      : rows.filter((r) => r.item_id && Number(r.quantity) > 0).map((r) => ({ item_id: r.item_id, quantity: Number(r.quantity) }))
    if (!items.length) return toast.error('Keep at least one item. To remove the whole return, cancel it instead.')
    setSaving(true)
    const { error } = await supabase.rpc('change_supplier_return', { p_slip_id: slip.id, p_items: items, p_reason: reason })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`Return ${slip.slip_number} changed.`)
    for (const key of ['supplier_return_slips', 'pending_payables', 'vendor_dashboard', 'return_bill_lines', 'returnable_items']) qc.invalidateQueries({ queryKey: [key] })
    invalidateInventory(qc)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="text-sm font-semibold text-ink-950">Change the items of {slip.slip_number}</div>
        {fromBill ? (
          <table className="table-base">
            <thead><tr><th>Item on the bill</th><th className="num">Can return</th><th className="num w-32">Return qty</th></tr></thead>
            <tbody>
              {(linesQ.data || []).map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{qty(billLeft(l))} {l.unit_text || ''}</td>
                  <td className="num"><Input type="number" min="0" max={billLeft(l)} step="any" disabled={billLeft(l) <= 0} value={billQty[l.id] ?? ''} onChange={(e) => setBillQty({ ...billQty, [l.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-7">
                  <Select value={r.item_id || ''} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, item_id: e.target.value } : x)))}>
                    <option value="">Choose…</option>
                    {options.map((id) => <option key={id} value={id}>{nameOf(id)}{stock.has(id) ? ` — ${qty(stock.get(id))} available` : ''}</option>)}
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input type="number" min="0.0001" step="0.0001" value={r.quantity} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
                </div>
                <div className="col-span-2"><button type="button" className="btn-ghost text-xs" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} disabled={rows.length === 1}>Remove</button></div>
              </div>
            ))}
            <button type="button" className="btn-secondary text-xs" onClick={() => setRows([...rows, { item_id: '', quantity: '' }])}>+ Add item</button>
          </div>
        )}
        <Field label="Why is it being changed?"><Input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
