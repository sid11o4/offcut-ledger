import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { Field, Input, Select } from './ui'
import { useInventoryItems, useInventoryLocations } from '../lib/queries'

// Any-location-to-any-location transfer (record_inventory_transfer): cost follows the stock,
// per spec. designProjectId pre-selects that project's own location as the default source or
// destination, but any pair of locations can be chosen.
export default function TransferModal({ designProjectId, initial = {}, title = 'Transfer inventory', onClose, onSaved }) {
  const toast = useToast()
  const itemsQ = useInventoryItems()
  const locationsQ = useInventoryLocations()
  const defaultLocation = (locationsQ.data || []).find((l) => l.design_project_id === designProjectId)?.id || ''
  const companyLocation = (locationsQ.data || []).find((l) => l.kind === 'company')?.id || ''
  const [form, setForm] = useState({
    item_id: initial.item_id || '',
    from: initial.from || companyLocation,
    to: initial.to || defaultLocation || companyLocation,
    quantity: initial.quantity ? String(initial.quantity) : '',
    notes: initial.notes || '',
  })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.item_id || !form.from || !form.to || !form.quantity) return toast.error('Fill in every field.')
    if (form.from === form.to) return toast.error('Source and destination must differ.')
    setSaving(true)
    const { error } = await supabase.rpc('record_inventory_transfer', {
      p_item_id: form.item_id, p_from_location_id: form.from, p_to_location_id: form.to,
      p_quantity: Number(form.quantity), p_notes: form.notes || null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">{title}</div>
        <Field label="Material">
          <Select required value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
            <option value="">Select…</option>
            {(itemsQ.data || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Select required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
              {(locationsQ.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="To">
            <Select required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
              {(locationsQ.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Quantity"><Input type="number" min="0.0001" step="0.0001" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Notes (optional)"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <p className="text-xs text-ink-500">The cost moves with the stock at the source location's current average cost.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : title === 'Transfer inventory' ? 'Transfer' : 'Return'}</button>
        </div>
      </form>
    </div>
  )
}
