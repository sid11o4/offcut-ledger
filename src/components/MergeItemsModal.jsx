import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useInventoryItems, invalidateInventory } from '../lib/queries'
import { useToast } from './Toast'
import { Input } from './ui'

// Opened from an item's Merge button: pick the other item in the inventory it is the same as. Which of the two is kept
// can be swapped before confirming. Everything of the retired item (stock, history, bills, slips) moves to the kept one,
// and its name is remembered so a later bill using that name lands on the kept item.
export default function MergeItemsModal({ item, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const [search, setSearch] = useState('')
  const [other, setOther] = useState(null)
  const [keepOther, setKeepOther] = useState(true) // the picked item survives; this item is merged into it
  const [saving, setSaving] = useState(false)

  const unit = item.units?.name || item.units?.code || ''
  const candidates = (itemsQ.data || [])
    .filter((i) => i.active !== false && !i.is_composite && i.id !== item.id && i.unit_id === item.unit_id)
    .filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  const keep = other ? (keepOther ? other : item) : null
  const away = other ? (keepOther ? item : other) : null

  async function submit() {
    setSaving(true)
    const { error } = await supabase.rpc('merge_inventory_item', { p_from_item: away.id, p_into_item: keep.id })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`"${away.name}" merged into "${keep.name}".`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">Merge “{item.name}” with…</div>
        {!other ? (
          <>
            <p className="text-xs text-ink-500">Click the item it is the same as. Only items measured in {unit || 'the same unit'} are listed.</p>
            <Input autoFocus placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="max-h-72 overflow-y-auto divide-y divide-ink-100 border border-ink-100 rounded-md">
              {candidates.length === 0 && <li className="p-3 text-sm text-ink-500">No other item to merge with.</li>}
              {candidates.map((i) => (
                <li key={i.id}>
                  <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-ink-50" onClick={() => setOther(i)}>{i.name}</button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div>
          </>
        ) : (
          <>
            <div className="text-sm text-ink-800 space-y-1.5">
              <div><span className="text-xs text-ink-500">Keep</span><div className="font-medium">{keep.name}</div></div>
              <div><span className="text-xs text-ink-500">Merge away (retired)</span><div className="font-medium">{away.name}</div></div>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setKeepOther(!keepOther)}>Swap: keep “{away.name}” instead</button>
            <p className="text-xs text-ink-500">All of “{away.name}” moves to “{keep.name}”: stock in every location, history, bills and slips. This cannot be undone.</p>
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn-primary flex-1" disabled={saving} onClick={submit}>{saving ? 'Merging…' : 'Merge'}</button>
              <button type="button" className="btn-secondary" onClick={() => setOther(null)} disabled={saving}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
