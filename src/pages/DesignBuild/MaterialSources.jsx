import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { EmptyState, LoadingBlock } from '../../components/ui'
import { invalidateInventory } from '../../lib/queries'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Where one material's stock came from: its vendor bills, and any direct purchases with no vendor.
// Each source can be corrected here.
export default function MaterialSources({ itemId, projectId }) {
  const q = useQuery({
    queryKey: ['material_sources', itemId],
    queryFn: async () => {
      const [itemsR, directR] = await Promise.all([
        supabase.from('supplier_bill_items')
          .select('id, quantity, rate_inclusive, total_amount, bill_id, supplier_bills(id, internal_bill_number, bill_date, status, bill_source, supplier_text, suppliers(name))')
          .eq('inventory_item_id', itemId),
        supabase.from('inventory_transactions')
          .select('id, txn_date, quantity, unit_cost, total_cost, reversed_by, reference_type, location_id, inventory_locations(name, kind, design_projects(name))')
          .eq('item_id', itemId).eq('txn_type', 'purchase').eq('reference_type', 'adjustment').is('reversed_by', null)
          .order('txn_date', { ascending: false }),
      ])
      if (itemsR.error) throw itemsR.error
      if (directR.error) throw directR.error
      return { bills: itemsR.data || [], direct: directR.data || [] }
    },
  })
  if (q.isLoading) return <LoadingBlock />
  if (q.error) return <EmptyState title="Could not load the sources" hint={q.error.message} />
  return (
    <div className="space-y-4">
      <VendorBills rows={q.data.bills} itemId={itemId} projectId={projectId} />
      <DirectPurchases rows={q.data.direct} itemId={itemId} projectId={projectId} />
    </div>
  )
}

function useRefresh(itemId, projectId) {
  const qc = useQueryClient()
  return () => {
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['material_sources', itemId] })
    qc.invalidateQueries({ queryKey: ['project_ceo_raw', projectId] })
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    qc.invalidateQueries({ queryKey: ['design_project_stock'] })
    qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] })
    qc.invalidateQueries({ queryKey: ['supplier_bill'] })
  }
}

function VendorBills({ rows, itemId, projectId }) {
  const toast = useToast()
  const refresh = useRefresh(itemId, projectId)
  const bills = new Map()
  for (const r of rows) {
    const b = r.supplier_bills
    if (!b) continue
    const cur = bills.get(b.id) || { bill: b, quantity: 0, value: 0 }
    cur.quantity += Number(r.quantity)
    cur.value += Number(r.total_amount || 0)
    bills.set(b.id, cur)
  }
  const list = [...bills.values()].sort((a, b) => String(b.bill.bill_date).localeCompare(String(a.bill.bill_date)))

  async function run(label, fn, success) {
    const { error } = await fn()
    if (error) return toast.error(error.message)
    toast.success(success)
    refresh()
  }
  async function voidBill(b) {
    const reason = window.prompt(`Void bill ${b.internal_bill_number}? Its stock is taken back out. Why?`)
    if (!reason) return
    run('void', () => supabase.rpc('void_supplier_bill', { p_bill_id: b.id, p_reason: reason }), 'Bill voided. Its stock is taken back out.')
  }
  async function reopenBill(b) {
    const reason = window.prompt(`Reopen bill ${b.internal_bill_number} to correct it? Why?`)
    if (!reason) return
    run('reopen', () => supabase.rpc('reopen_supplier_bill', { p_bill_id: b.id, p_reason: reason }), 'Bill reopened. Open it to correct it, then approve it again.')
  }
  async function deleteBill(b) {
    if (!window.confirm(`Delete bill ${b.internal_bill_number}? This cannot be undone.`)) return
    run('delete', () => supabase.rpc('delete_supplier_bill', { p_bill_id: b.id }), 'Bill deleted.')
  }

  return (
    <div>
      <div className="text-xs font-medium text-ink-600 mb-1">From vendor bills</div>
      {!list.length ? <EmptyState title="No vendor bills for this material" /> : (
        <table className="table-base">
          <thead><tr><th>Bill</th><th>Vendor</th><th>Date</th><th>Status</th><th className="num">Qty</th><th className="num">Value</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map(({ bill: b, quantity, value }) => (
              <tr key={b.id}>
                <td className="font-mono text-xs">{b.internal_bill_number}</td>
                <td>{b.suppliers?.name || b.supplier_text || '—'}</td>
                <td>{displayDate(b.bill_date)}</td>
                <td className="capitalize">{b.status === 'void' ? 'Voided' : b.status.replace('_', ' ')}</td>
                <td className="num">{qty(quantity)}</td>
                <td className="num">{money(value)}</td>
                <td className="whitespace-nowrap">
                  {b.status === 'pending_review' && <>
                    <Link className="btn-ghost text-xs px-2" to={`/accounts/bills?bill=${b.id}`}>Open</Link>
                    <button className="btn-ghost text-xs px-2" onClick={() => deleteBill(b)}>Delete</button>
                  </>}
                  {b.status === 'approved' && <button className="btn-ghost text-xs px-2" onClick={() => voidBill(b)}>Void to correct</button>}
                  {b.status === 'void' && <button className="btn-ghost text-xs px-2" onClick={() => reopenBill(b)}>Reopen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function DirectPurchases({ rows, itemId, projectId }) {
  const toast = useToast()
  const refresh = useRefresh(itemId, projectId)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ quantity: '', unit_cost: '', date: '', reason: '' })

  function startEdit(r) {
    setEditing(r.id)
    setForm({ quantity: String(Number(r.quantity)), unit_cost: String(Number(r.unit_cost)), date: String(r.txn_date).slice(0, 10), reason: '' })
  }
  async function save(r) {
    const { error } = await supabase.rpc('correct_direct_purchase', {
      p_txn_id: r.id, p_quantity: Number(form.quantity), p_unit_cost: Number(form.unit_cost), p_date: form.date, p_reason: form.reason,
    })
    if (error) return toast.error(error.message)
    toast.success('Purchase corrected.')
    setEditing(null)
    refresh()
  }
  async function reverse(r) {
    const reason = window.prompt('Reverse this direct purchase? Why?')
    if (!reason) return
    const { error } = await supabase.rpc('reverse_inventory_transaction', { p_txn_id: r.id, p_reason: reason })
    if (error) return toast.error(error.message)
    toast.success('Purchase reversed.')
    refresh()
  }

  return (
    <div>
      <div className="text-xs font-medium text-ink-600 mb-1">Direct purchases (no vendor bill)</div>
      {!rows.length ? <EmptyState title="No direct purchases for this material" /> : (
        <table className="table-base">
          <thead><tr><th>Date</th><th>Where</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Value</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>{displayDate(r.txn_date)}</td>
                  <td>{r.inventory_locations?.design_projects?.name || r.inventory_locations?.name}</td>
                  <td className="num">{qty(r.quantity)}</td>
                  <td className="num">{money(r.unit_cost)}</td>
                  <td className="num">{money(r.total_cost)}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-ghost text-xs px-2" onClick={() => (editing === r.id ? setEditing(null) : startEdit(r))}>{editing === r.id ? 'Cancel' : 'Correct'}</button>
                    <button className="btn-ghost text-xs px-2" onClick={() => reverse(r)}>Reverse</button>
                  </td>
                </tr>
                {editing === r.id && (
                  <tr>
                    <td colSpan={6} className="bg-ink-50">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                        <label className="text-xs">Quantity<input type="number" min="0" step="0.0001" className="field-input mt-1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
                        <label className="text-xs">Unit cost<input type="number" min="0" step="0.01" className="field-input mt-1" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></label>
                        <label className="text-xs">Date<input type="date" className="field-input mt-1" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
                        <label className="text-xs md:col-span-1">Reason<input className="field-input mt-1" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                        <button className="btn-primary" onClick={() => save(r)}>Save correction</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
