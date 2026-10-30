import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock, Field, Input, Select, Badge } from '../../components/ui'
import { useCompanyInventoryValue, useInventoryItems } from '../../lib/queries'
import { money, qty } from '../../lib/format'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import TransferModal from '../../components/TransferModal'

export default function CompanyInventory() {
  const valueQ = useCompanyInventoryValue()
  const { hasPermission } = useAuth()
  const [transferOpen, setTransferOpen] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const canOperate = hasPermission('inventory_operate')

  const rows = valueQ.data || []
  const total = rows.reduce((s, r) => s + Number(r.value), 0)

  return (
    <div>
      <PageHeader
        title="Company Inventory"
        subtitle="The shared pool. Transferred to a project's own inventory on request; the cost moves with it."
        actions={canOperate && (
          <>
            <button className="btn-secondary" onClick={() => setTransferOpen(true)}>Transfer</button>
            <button className="btn-primary" onClick={() => setPurchaseOpen(true)}>Record purchase</button>
          </>
        )}
      />

      <Card className="mb-5">
        <StatCard label="Total value on hand" value={money(total)} money />
      </Card>

      <Card>
        {valueQ.isLoading ? <LoadingBlock /> : !rows.length ? (
          <EmptyState title="No stock in the company pool" hint={canOperate ? 'Record a purchase to add material.' : undefined} />
        ) : (
          <table className="table-base">
            <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">Avg cost</th><th className="num">Value</th><th className="num"></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const low = r.quantity < 10
                return (
                  <tr key={r.item_id}>
                    <td>{r.item_name}</td>
                    <td className="num">{qty(r.quantity)}</td>
                    <td className="num">{money(r.avg_unit_cost)}</td>
                    <td className="num font-medium">{money(r.value)}</td>
                    <td className="num">{low && <Badge tone="warn">Low</Badge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {transferOpen && (
        <TransferModal
          onClose={() => setTransferOpen(false)}
          onSaved={() => { setTransferOpen(false) }}
        />
      )}
      {purchaseOpen && <PurchaseModal onClose={() => setPurchaseOpen(false)} />}
    </div>
  )
}

function PurchaseModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const [form, setForm] = useState({ item_id: '', quantity: '', unit_cost: '', date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { data: company } = await supabase.from('inventory_locations').select('id').eq('kind', 'company').single()
    const { error } = await supabase.rpc('record_inventory_purchase', {
      p_item_id: form.item_id, p_location_id: company.id, p_quantity: Number(form.quantity),
      p_unit_cost: Number(form.unit_cost), p_txn_date: form.date, p_reference_type: 'adjustment', p_reference_id: null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Purchase recorded.')
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">Record a direct purchase into company inventory</div>
        <Field label="Material">
          <Select required value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
            <option value="">Select…</option>
            {(itemsQ.data || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><Input type="number" min="0.0001" step="0.0001" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          <Field label="Unit cost (Rs.)"><Input type="number" min="0" step="0.01" required value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></Field>
        </div>
        <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Record'}</button>
        </div>
      </form>
    </div>
  )
}
