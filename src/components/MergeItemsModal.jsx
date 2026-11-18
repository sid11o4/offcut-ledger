import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useInventoryItems, invalidateInventory } from '../lib/queries'
import { useToast } from './Toast'
import { Field, Select } from './ui'

// Merge a duplicate material into the one to keep. All its stock, history, bills and slips move to the kept item, and the
// duplicate's name is remembered, so a later bill using that name lands on the kept item.
export default function MergeItemsModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const [fromId, setFromId] = useState('')
  const [intoId, setIntoId] = useState('')
  const [saving, setSaving] = useState(false)
  const items = (itemsQ.data || []).filter((i) => i.active !== false && !i.is_composite)
  const from = items.find((i) => i.id === fromId)
  const into = items.find((i) => i.id === intoId)
  const unitOf = (i) => i?.units?.code || ''
  const label = (i) => `${i.name}${i.units ? ` (${i.units.name || i.units.code})` : ''}`
  const keepOptions = items.filter((i) => i.id !== fromId && (!from || i.unit_id === from.unit_id))
  const sameUnit = !from || !into || from.unit_id === into.unit_id

  async function submit(e) {
    e.preventDefault()
    if (!window.confirm(`Merge "${from.name}" into "${into.name}"? All its stock and history move to "${into.name}", and "${from.name}" is retired. This cannot be undone.`)) return
    setSaving(true)
    const { error } = await supabase.rpc('merge_inventory_item', { p_from_item: fromId, p_into_item: intoId })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`"${from.name}" merged into "${into.name}".`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">Merge two materials</div>
        <p className="text-xs text-ink-500">Use this when the same material has been created twice under different names. Both must use the same unit.</p>
        <Field label="Duplicate to merge away">
          <Select required value={fromId} onChange={(e) => { setFromId(e.target.value); setIntoId('') }}>
            <option value="">Select…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
          </Select>
        </Field>
        <Field label="Material to keep">
          <Select required value={intoId} onChange={(e) => setIntoId(e.target.value)} disabled={!fromId}>
            <option value="">{fromId ? 'Select…' : 'Choose the duplicate first'}</option>
            {keepOptions.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
          </Select>
        </Field>
        {from && into && sameUnit && (
          <div className="text-xs text-ink-600 bg-ink-50 rounded px-2 py-1.5">
            "{from.name}" becomes "{into.name}" everywhere ({unitOf(into)}). Its name is remembered for future bills.
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={saving || !fromId || !intoId || !sameUnit}>{saving ? 'Merging…' : 'Merge'}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
