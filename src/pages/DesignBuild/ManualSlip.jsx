import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, Field, Input, Select, Badge } from '../../components/ui'
import { useInventoryItems, useInventoryLocations, useDesignProjects, useUnits, invalidateInventory } from '../../lib/queries'
import { INVENTORY_CATEGORIES } from './CompanyInventory'

const blankLine = () => ({ item_id: '', text: '', unit: 'SHEET', category: '', quantity: '', from_location_id: '', to_location_id: '' })

// The manual reporting mode for consumption/transfer (spec): a header plus line items, posted
// as real inventory movements by post_inventory_slip() -- the same rules (project-stock-first,
// cost-follows-transfer) as every other inventory path.
export default function ManualSlip() {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const locationsQ = useInventoryLocations()
  const projectsQ = useDesignProjects()
  const unitsQ = useUnits()
  const [slipType, setSlipType] = useState('consumption')
  const [designProjectId, setDesignProjectId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([blankLine()])
  const [saving, setSaving] = useState(false)
  const [lastSlip, setLastSlip] = useState(null)
  const [editing, setEditing] = useState(null) // the consumption slip being corrected

  const slipsQ = useQuery({
    queryKey: ['inventory_slips'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_slips')
        .select('*, design_projects(name), inventory_slip_items(id, item_id, quantity, inventory_items(name))')
        .order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return data
    },
  })

  function startEdit(slip) {
    setEditing(slip)
    setSlipType('consumption')
    setDesignProjectId(slip.design_project_id || '')
    setDate(slip.slip_date)
    setNotes(slip.notes || '')
    setLines((slip.inventory_slip_items || []).map((i) => ({ ...blankLine(), item_id: i.item_id, text: i.inventory_items?.name || '', quantity: String(i.quantity) })))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function cancelEdit() {
    setEditing(null)
    setLines([blankLine()])
    setNotes('')
  }

  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, blankLine()])
  }
  function removeLine(i) {
    setLines((ls) => ls.filter((_, idx) => idx !== i))
  }

  async function submit(e) {
    e.preventDefault()
    if (slipType === 'consumption' && !designProjectId) return toast.error('Select the project this consumption is against.')
    const isConsumption = slipType === 'consumption'
    const validLines = lines.filter((l) => (isConsumption ? (l.item_id || l.text.trim()) : l.item_id) && l.quantity)
    if (!validLines.length) return toast.error('Add at least one line item.')

    setSaving(true)
    // A material typed in that is not in inventory is added first (in its category and unit); it shows
    // as negative stock until it is bought.
    try {
      for (const l of validLines) {
        if (isConsumption && !l.item_id) {
          const { data: id, error } = await supabase.rpc('ensure_inventory_item', { p_name: l.text.trim(), p_unit_code: l.unit, p_category: l.category || null })
          if (error) throw error
          l.item_id = id
        }
      }
    } catch (err) {
      setSaving(false)
      return toast.error(err.message || 'Could not add the new material.')
    }
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
    if (editing) {
      const { error: corrErr } = await supabase.rpc('correct_consumption_slip', {
        p_slip_id: editing.id, p_date: date, p_design_project_id: designProjectId, p_notes: notes || null,
        p_lines: validLines.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) })),
      })
      setSaving(false)
      if (corrErr) return toast.error(corrErr.message)
      invalidateInventory(qc)
      qc.invalidateQueries({ queryKey: ['inventory_slips'] })
      toast.success(`${editing.slip_number} corrected.`)
      setEditing(null)
      setLines([blankLine()])
      setNotes('')
      return
    }
    const { data: slip, error: slipErr } = await supabase.from('inventory_slips').insert({
      slip_type: slipType, slip_date: date, design_project_id: slipType === 'consumption' ? designProjectId : null, notes: notes || null,
    }).select().single()
    if (slipErr) { setSaving(false); return toast.error(slipErr.message) }

    const { error: itemsErr } = await supabase.from('inventory_slip_items').insert(
      validLines.map((l) => ({
        slip_id: slip.id, item_id: l.item_id, quantity: Number(l.quantity),
        from_location_id: slipType === 'transfer' ? l.from_location_id : null,
        to_location_id: slipType === 'transfer' ? l.to_location_id : null,
      }))
    )
    if (itemsErr) { setSaving(false); return toast.error(itemsErr.message) }

    const { error: postErr } = await supabase.rpc('post_inventory_slip', { p_slip_id: slip.id })
    setSaving(false)
    if (postErr) return toast.error(postErr.message)

    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['inventory_slips'] })
    toast.success(`${slip.slip_number} posted.`)
    setLastSlip(slip.slip_number)
    setLines([blankLine()])
    setNotes('')
  }

  return (
    <div>
      <PageHeader title="Manual Consumption / Transfer Slip" subtitle="For site consumption or a stock move not already captured by an Design Build Order bill." />
      {editing && (
        <div className="mb-3 rounded-md border border-brand-500 bg-brand-100 p-3 text-sm text-ink-900">
          Correcting <strong>{editing.slip_number}</strong>. Saving reverses what it took out of stock and posts the corrected lines. The earlier entries stay in the audit trail.
        </div>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Slip type">
              <Select value={slipType} disabled={!!editing} onChange={(e) => setSlipType(e.target.value)}>
                <option value="consumption">Consumption</option>
                <option value="transfer">Transfer</option>
              </Select>
            </Field>
            {slipType === 'consumption' && (
              <Field label="Project">
                <Select required value={designProjectId} onChange={(e) => setDesignProjectId(e.target.value)}>
                  <option value="">Select…</option>
                  {(projectsQ.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>

          <div>
            <div className="field-label mb-2">Line items</div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-end">
                  {slipType === 'consumption' ? (
                    <div className="flex-1">
                      <Input
                        list={`slip-materials-${i}`} placeholder="Type or pick a material…" value={l.text}
                        onChange={(e) => {
                          const text = e.target.value
                          const match = (itemsQ.data || []).find((it) => it.active !== false && it.name.toLowerCase() === text.trim().toLowerCase())
                          updateLine(i, { text, item_id: match ? match.id : '' })
                        }}
                      />
                      <datalist id={`slip-materials-${i}`}>
                        {(itemsQ.data || []).filter((it) => it.active !== false && !it.is_composite).map((it) => <option key={it.id} value={it.name} />)}
                        {(itemsQ.data || []).filter((it) => it.active !== false && it.is_composite).map((it) => <option key={it.id} value={it.name} />)}
                      </datalist>
                      {l.text.trim() && !l.item_id && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                          <span>Not in inventory: added as new, negative stock until bought.</span>
                          <Select className="w-auto py-1 text-xs" value={l.category} onChange={(e) => updateLine(i, { category: e.target.value })}>
                            <option value="">Others</option>
                            {INVENTORY_CATEGORIES.filter((c) => c !== 'Others').map((c) => <option key={c} value={c}>{c}</option>)}
                          </Select>
                          <Select className="w-auto py-1 text-xs" value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })}>
                            {(unitsQ.data || []).filter((u) => u.active !== false && u.inventory_unit).map((u) => <option key={u.id} value={u.code}>{u.name || u.code}</option>)}
                          </Select>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1"><Select value={l.item_id} onChange={(e) => updateLine(i, { item_id: e.target.value })}>
                      <option value="">Material…</option>
                      {(itemsQ.data || []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </Select></div>
                  )}
                  <div className="w-28"><Input type="number" min="0.0001" step="0.0001" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></div>
                  {slipType === 'transfer' && (
                    <>
                      <div className="flex-1"><Select value={l.from_location_id} onChange={(e) => updateLine(i, { from_location_id: e.target.value })}>
                        <option value="">From…</option>
                        {(locationsQ.data || []).map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                      </Select></div>
                      <div className="flex-1"><Select value={l.to_location_id} onChange={(e) => updateLine(i, { to_location_id: e.target.value })}>
                        <option value="">To…</option>
                        {(locationsQ.data || []).map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                      </Select></div>
                    </>
                  )}
                  <button type="button" className="btn-ghost text-xs px-2 text-bad" onClick={() => removeLine(i)}>Remove</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost text-xs mt-2" onClick={addLine}>+ Add line</button>
          </div>

          <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : editing ? `Save correction to ${editing.slip_number}` : 'Post slip'}</button>
            {editing && <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel correction</button>}
            {lastSlip && <span className="text-xs text-ok">Last posted: {lastSlip}</span>}
          </div>
        </form>
      </Card>

      <Card title="Past slips" className="mt-5">
        {!slipsQ.data?.length ? <p className="text-sm text-ink-500">No slips yet.</p> : (
          <div className="divide-y divide-ink-100">
            {slipsQ.data.map((sl) => (
              <div key={sl.id} className="py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-ink-950">{sl.slip_number}</span>
                    <Badge tone={sl.slip_type === 'consumption' ? 'warn' : 'ok'}>{sl.slip_type}</Badge>
                    <span className="text-ink-500 tnum">{sl.slip_date}</span>
                    {sl.design_projects?.name && <span className="text-ink-600">· {sl.design_projects.name}</span>}
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5 truncate">
                    {(sl.inventory_slip_items || []).map((i) => `${i.inventory_items?.name} × ${Number(i.quantity)}`).join(', ')}
                  </div>
                </div>
                {sl.slip_type === 'consumption' && (
                  <button className="btn-secondary text-xs" onClick={() => startEdit(sl)}>Correct</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
