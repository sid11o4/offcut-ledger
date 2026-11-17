import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Field, Input, Select } from '../../components/ui'
import { useInventoryItems, invalidateInventory } from '../../lib/queries'
import { money, qty } from '../../lib/format'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'

// A composite material is a raw board, a skin on one side, an optional skin on the other side and the
// job works already completed on it. Its value per unit is the sum of the parts.
export function useCompositeParts(itemId) {
  return useQuery({
    queryKey: ['composite_parts', itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_composite_parts')
        .select('*, component:inventory_items!component_item_id(name)')
        .eq('item_id', itemId).order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}

// The pasting cost per sheet: the "Pasting" job work's current Design Build Order rate.
export function usePastingRate() {
  return useQuery({
    queryKey: ['pasting_rate'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rates')
        .select('rate, job_work_services!inner(name), rate_categories!inner(name)')
        .eq('job_work_services.name', 'Pasting')
        .eq('rate_categories.name', 'Design Build Order')
        .is('effective_to', null)
        .limit(1)
      if (error) throw error
      return Number(data?.[0]?.rate || 0)
    },
  })
}

// Current value per unit of every composite, with pasting at today's catalogue rate.
export function useCompositeValues() {
  return useQuery({
    queryKey: ['composite_values'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_composite_values').select('item_id, unit_value')
      if (error) throw error
      return new Map((data || []).map((r) => [r.item_id, Number(r.unit_value)]))
    },
  })
}

const PASTING_LABELS = ['Pasting (single side)', 'Pasting (both sides)']

const ROLE_LABEL = { raw: 'Raw board', skin1: 'Skin 1', skin2: 'Skin 2', jobwork: 'Job work' }

export function CompositeBreakdown({ itemId }) {
  const q = useCompositeParts(itemId)
  const parts = q.data || []
  if (!parts.length) return <div className="px-3 py-2 text-xs text-ink-500">{q.isLoading ? 'Loading…' : 'No parts recorded.'}</div>
  const rateQ = usePastingRate()
  const skins = parts.filter((p) => p.role === 'skin1' || p.role === 'skin2').length
  const pasting = skins * (rateQ.data || 0)
  const total = parts.reduce((s, p) => s + Number(p.unit_cost), 0) + pasting
  return (
    <div className="px-3 py-2">
      <div className="text-xs font-medium text-ink-700 mb-1">Made up of (per unit)</div>
      <table className="table-base">
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}>
              <td className="text-ink-500 w-28">{ROLE_LABEL[p.role]}</td>
              <td>{p.component?.name || p.label}</td>
              <td className="num">{money(p.unit_cost)}</td>
            </tr>
          ))}
          <tr>
            <td className="text-ink-500">Job work</td>
            <td>{skins > 1 ? 'Pasting (both sides)' : 'Pasting (single side)'} <span className="text-xs text-ink-500">at the current Pasting rate</span></td>
            <td className="num">{money(pasting)}</td>
          </tr>
          <tr><td colSpan={2} className="font-medium">Combined value</td><td className="num font-medium">{money(total)}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

export default function CompositeModal({ onClose, costOf, existing }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const partsQ = useCompositeParts(existing?.id)
  const materials = (itemsQ.data || []).filter((i) => i.active !== false && !i.is_composite)

  const pastingQ = usePastingRate()
  const [raw, setRaw] = useState({ item: '', cost: '' })
  const [skin1, setSkin1] = useState({ item: '', cost: '' })
  const [skin2, setSkin2] = useState({ item: '', cost: '' })
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // When editing, fill the form from the saved parts once they arrive.
  if (existing && partsQ.data && !loaded) {
    const by = (r) => partsQ.data.find((p) => p.role === r)
    const pick = (p) => (p ? { item: p.component_item_id, cost: String(p.unit_cost) } : { item: '', cost: '' })
    setRaw(pick(by('raw'))); setSkin1(pick(by('skin1'))); setSkin2(pick(by('skin2')))
    setJobs(partsQ.data.filter((p) => p.role === 'jobwork' && !PASTING_LABELS.includes(p.label)).map((p) => ({ label: p.label || '', cost: String(p.unit_cost) })))
    setLoaded(true)
  }

  // Choosing a material fills its cost from stock (or its default rate); the cost stays editable.
  const choose = (setter) => (itemId) => setter({ item: itemId, cost: itemId && costOf(itemId) ? String(costOf(itemId)) : '' })
  const num = (v) => Number(v) || 0
  // Pasting is costed by the sides skinned: one skin is single-side pasting, two skins is both sides.
  const nameOf = (id) => materials.find((m) => m.id === id)?.name
  const name = [nameOf(raw.item), nameOf(skin1.item), skin2.item ? nameOf(skin2.item) : null].filter(Boolean).join(' / ')
  const pastingRate = pastingQ.data || 0
  const pasting = skin1.item ? { label: skin2.item ? PASTING_LABELS[1] : PASTING_LABELS[0], cost: skin2.item ? pastingRate * 2 : pastingRate } : null
  const total = num(raw.cost) + num(skin1.cost) + (skin2.item ? num(skin2.cost) : 0) + (pasting?.cost || 0) + jobs.reduce((s, j) => s + num(j.cost), 0)

  async function submit(e) {
    e.preventDefault()
    const parts = [
      { role: 'raw', component_item_id: raw.item, unit_cost: num(raw.cost) },
      { role: 'skin1', component_item_id: skin1.item, unit_cost: num(skin1.cost) },
      ...(skin2.item ? [{ role: 'skin2', component_item_id: skin2.item, unit_cost: num(skin2.cost) }] : []),
      ...jobs.filter((j) => j.label.trim() || j.cost).map((j) => ({ role: 'jobwork', label: j.label, unit_cost: num(j.cost) })),
    ]
    setSaving(true)
    const { error } = await supabase.rpc('save_composite_item', { p_item_id: existing?.id || null, p_name: name, p_parts: parts })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`${name} saved at ${money(total)} per unit.`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
    qc.invalidateQueries({ queryKey: ['composite_parts'] })
    qc.invalidateQueries({ queryKey: ['composite_values'] })
    onClose()
  }

  const materialSelect = (state, setter, required) => (
    <Select required={required} value={state.item} onChange={(e) => choose(setter)(e.target.value)}>
      <option value="">{required ? 'Select…' : 'None'}</option>
      {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </Select>
  )
  const costInput = (state, setter, disabled) => (
    <Input type="number" min="0" step="0.01" placeholder="Cost / unit" disabled={disabled} required={!disabled}
      value={state.cost} onChange={(e) => setter({ ...state, cost: e.target.value })} />
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <form onSubmit={submit} className="card p-5 w-full max-w-xl space-y-3">
        <div className="text-sm font-semibold text-ink-950">{existing ? 'Edit composite material' : 'New composite material'}</div>
        <p className="text-xs text-ink-500">A raw board with its skins and the job works already done on it, held as one material valued at the sum of its parts.</p>
        <div className="grid grid-cols-3 gap-3 items-end">
          <div className="col-span-2"><Field label="Raw board">{materialSelect(raw, setRaw, true)}</Field></div>
          <Field label=" ">{costInput(raw, setRaw)}</Field>
          <div className="col-span-2"><Field label="Skin 1">{materialSelect(skin1, setSkin1, true)}</Field></div>
          <Field label=" ">{costInput(skin1, setSkin1)}</Field>
          <div className="col-span-2"><Field label="Skin 2 (optional)">{materialSelect(skin2, setSkin2, false)}</Field></div>
          <Field label=" ">{costInput(skin2, setSkin2, !skin2.item)}</Field>
        </div>

        <div className="rounded border border-ink-100 px-3 py-2 text-sm">
          <div className="text-xs text-ink-500">Name</div>
          <div className="font-medium text-ink-950">{name || 'Raw board / Skin 1 / Skin 2'}</div>
          {pasting && (
            <div className="mt-1 text-xs text-ink-500">
              {pasting.label}: <span className="tnum text-ink-950">{money(pasting.cost)}</span> per unit, taken live from the Pasting rate in the job work catalogue{skin2.item ? ' (both sides)' : ''}.
              {!pastingRate && !pastingQ.isLoading && ' No Pasting rate is set for Design Build Order.'}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-ink-700">Other completed job works (cost per unit)</div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setJobs([...jobs, { label: '', cost: '' }])}>+ Add job work</button>
          </div>
          {jobs.map((j, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 mb-2">
              <div className="col-span-3"><Input placeholder="e.g. Lamination, Edge banding" value={j.label} onChange={(e) => setJobs(jobs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></div>
              <div className="col-span-2"><Input type="number" min="0" step="0.01" placeholder="Cost / unit" value={j.cost} onChange={(e) => setJobs(jobs.map((x, k) => (k === i ? { ...x, cost: e.target.value } : x)))} /></div>
              <button type="button" className="btn-ghost text-xs" onClick={() => setJobs(jobs.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-ink-100 pt-3">
          <div className="text-sm text-ink-700">Combined value per unit</div>
          <div className="text-lg font-medium tnum">{money(total)}</div>
        </div>
        {existing && <p className="text-xs text-ink-500">Stock already held keeps the value it was entered at; the new value applies to stock entered from now on.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

// Makes composites from stock: one raw board and one skin (or two) leave company stock per unit made,
// and the composite comes in at their cost plus the completed job works.
export function MakeCompositeModal({ onClose, stockRows, composites, initialId, initialDate }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [itemId, setItemId] = useState(initialId || '')
  const [quantity, setQuantity] = useState('')
  const [date, setDate] = useState(initialDate || new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const partsQ = useCompositeParts(itemId)
  const parts = partsQ.data || []
  const q = Number(quantity) || 0
  const stockOf = (id) => stockRows.find((r) => r.item_id === id)
  const materialParts = parts.filter((p) => p.role !== 'jobwork')
  const pastingRateQ = usePastingRate()
  const skinCount = parts.filter((p) => p.role === 'skin1' || p.role === 'skin2').length
  const pastingCost = skinCount * (pastingRateQ.data || 0)
  const jobCost = parts.filter((p) => p.role === 'jobwork').reduce((s, p) => s + Number(p.unit_cost), 0) + pastingCost
  const unitCost = materialParts.reduce((s, p) => s + Number(stockOf(p.component_item_id)?.avg_unit_cost || 0), 0) + jobCost
  const short = materialParts.filter((p) => Number(stockOf(p.component_item_id)?.quantity || 0) < q)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('make_composite', { p_item_id: itemId, p_quantity: q, p_date: date })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`${q} made. Materials used from stock.`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <form onSubmit={submit} className="card p-5 w-full max-w-lg space-y-3">
        <div className="text-sm font-semibold text-ink-950">Make composite material</div>
        <p className="text-xs text-ink-500">Uses up one of each material per unit made, and adds the finished composite to company stock at their combined cost plus its job works.</p>
        <Field label="Composite">
          <Select required value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Select…</option>
            {composites.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity to make"><Input type="number" min="1" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {itemId && (
          <table className="table-base">
            <thead><tr><th>Used up</th><th className="num">Needed</th><th className="num">In stock</th><th className="num">Cost / unit</th></tr></thead>
            <tbody>
              {materialParts.map((p) => {
                const s = stockOf(p.component_item_id)
                const lacking = Number(s?.quantity || 0) < q
                return (
                  <tr key={p.id}>
                    <td>{ROLE_LABEL[p.role]}: {p.component?.name}</td>
                    <td className="num">{q || '—'}</td>
                    <td className={`num ${lacking ? 'text-bad' : ''}`}>{qty(s?.quantity || 0)}</td>
                    <td className="num">{money(s?.avg_unit_cost || 0)}</td>
                  </tr>
                )
              })}
              {itemId && skinCount > 0 && (
                <tr><td colSpan={3}>Job work: {skinCount > 1 ? 'Pasting (both sides)' : 'Pasting (single side)'}</td><td className="num">{money(pastingCost)}</td></tr>
              )}
              {parts.filter((p) => p.role === 'jobwork').map((p) => (
                <tr key={p.id}><td colSpan={3}>Job work: {p.label}</td><td className="num">{money(p.unit_cost)}</td></tr>
              ))}
              <tr><td colSpan={3} className="font-medium">Cost per composite</td><td className="num font-medium">{money(unitCost)}</td></tr>
            </tbody>
          </table>
        )}
        {short.length > 0 && q > 0 && <p className="text-xs text-bad">Not enough {short.map((p) => p.component?.name).join(', ')} in company stock.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !itemId || !q || short.length > 0} className="btn-primary">{saving ? 'Making…' : 'Make'}</button>
        </div>
      </form>
    </div>
  )
}
