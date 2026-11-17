import { Fragment, useState } from 'react'
import MaterialSources from './MaterialSources'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock, Field, Input, Select, Badge } from '../../components/ui'
import { Link } from 'react-router-dom'
import { useCompanyInventoryValue, useInventoryItems, useDesignProjectsSummary, useUnits, invalidateInventory } from '../../lib/queries'
import { money, qty } from '../../lib/format'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import TransferModal from '../../components/TransferModal'
import CompositeModal, { CompositeBreakdown, MakeCompositeModal } from './CompositeModal'

export default function CompanyInventory() {
  const valueQ = useCompanyInventoryValue()
  const itemsQ = useInventoryItems()
  // Each material's unit, to show beside its quantity.
  const unitOf = new Map((itemsQ.data || []).map((i) => [i.id, i.units?.name || i.units?.code]))
  const projectsQ = useDesignProjectsSummary()
  const { hasPermission } = useAuth()
  const qc = useQueryClient()
  const [transferOpen, setTransferOpen] = useState(false)
  const [openItem, setOpenItem] = useState(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [compositeOpen, setCompositeOpen] = useState(false)
  const [editComposite, setEditComposite] = useState(null)
  const [makeOpen, setMakeOpen] = useState(false)
  const canOperate = hasPermission('inventory_operate')

  const rows = valueQ.data || []
  const compositeIds = new Set((itemsQ.data || []).filter((i) => i.is_composite).map((i) => i.id))
  // A component's cost for the composite form: its average cost in the pool, else its default rate.
  const costOf = (id) => Number(rows.find((r) => r.item_id === id)?.avg_unit_cost || (itemsQ.data || []).find((i) => i.id === id)?.default_rate || 0)
  const total = rows.reduce((s, r) => s + Number(r.value), 0)

  return (
    <div>
      <PageHeader
        title="Company Inventory"
        subtitle="The shared pool. Transferred to a project's own inventory on request; the cost moves with it."
        actions={canOperate && (
          <>
            <button className="btn-secondary" onClick={() => setCompositeOpen(true)}>New composite material</button>
            <button className="btn-secondary" onClick={() => setMakeOpen(true)}>Make composite</button>
            <button className="btn-secondary" onClick={() => setTransferOpen(true)}>Transfer</button>
            <button className="btn-primary" onClick={() => setPurchaseOpen(true)}>Record purchase</button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Card>
          <div className="text-xs text-ink-500">Company Inventory</div>
          <div className="text-2xl font-medium tnum mt-1">{money(total)}</div>
          <div className="text-xs text-ink-500 mt-1">{rows.length} material{rows.length === 1 ? '' : 's'} in the shared pool</div>
        </Card>
        {(projectsQ.data || []).filter((p) => p.status !== 'completed').map((p) => (
          <Link key={p.id} to={`/design-build/projects/${p.id}`} className="card p-4 hover:bg-ink-50 block">
            <div className="text-xs text-ink-500 font-mono">{p.code}</div>
            <div className="font-medium text-ink-950 mt-0.5">{p.name}</div>
            <div className="text-2xl font-medium tnum mt-2">{money(p.current_inventory_value)}</div>
            <div className="text-xs text-ink-500 mt-1">Project warehouse</div>
          </Link>
        ))}
      </div>

      <Card>
        {valueQ.isLoading ? <LoadingBlock /> : !rows.length ? (
          <EmptyState title="No stock in the company pool" hint={canOperate ? 'Record a purchase to add material.' : undefined} />
        ) : (
          <table className="table-base">
            <thead><tr><th>Material</th><th className="num">Quantity</th><th>Unit</th><th className="num">Avg cost</th><th className="num">Value</th><th className="num"></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const low = r.quantity < 10
                return (
                  <Fragment key={r.item_id}>
                    <tr className="cursor-pointer" onClick={() => setOpenItem(openItem === r.item_id ? null : r.item_id)}>
                      <td>{r.item_name} {compositeIds.has(r.item_id) && <Badge tone="brand">Composite</Badge>} <span className="text-xs text-ink-500">{openItem === r.item_id ? '· hide details' : '· details'}</span></td>
                      <td className="num">{qty(r.quantity)}</td>
                      <td>{unitOf.get(r.item_id) || '—'}</td>
                      <td className="num">{money(r.avg_unit_cost)}</td>
                      <td className="num font-medium">{money(r.value)}</td>
                      <td className="num">{low && <Badge tone="warn">Low</Badge>}</td>
                    </tr>
                    {openItem === r.item_id && (
                      <tr>
                        <td colSpan={6} className="bg-ink-50">
                          {compositeIds.has(r.item_id) && (
                            <>
                              <CompositeBreakdown itemId={r.item_id} />
                              {canOperate && <button type="button" className="btn-ghost text-xs ml-3 mb-2" onClick={() => setEditComposite((itemsQ.data || []).find((i) => i.id === r.item_id))}>Edit composite</button>}
                            </>
                          )}
                          <MaterialSources itemId={r.item_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canOperate && <LinkPlaceholders />}

      {transferOpen && (
        <TransferModal
          onClose={() => setTransferOpen(false)}
          onSaved={() => { invalidateInventory(qc); setTransferOpen(false) }}
        />
      )}
      {purchaseOpen && <PurchaseModal onClose={() => setPurchaseOpen(false)} />}
      {makeOpen && <MakeCompositeModal stockRows={rows} composites={(itemsQ.data || []).filter((i) => i.is_composite && i.active !== false)} onClose={() => setMakeOpen(false)} />}
      {(compositeOpen || editComposite) && (
        <CompositeModal costOf={costOf} existing={editComposite} onClose={() => { setCompositeOpen(false); setEditComposite(null) }} />
      )}
    </div>
  )
}

// Items created from job work with negative stock, waiting to be matched to the real stock item.
// Picking the real item merges the placeholder into it: stock, history and references move across.
function LinkPlaceholders() {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const [targets, setTargets] = useState({})
  const placeholdersQ = useQuery({
    queryKey: ['placeholder_items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_stock')
        .select('item_id, quantity, inventory_items(id, name, unit_id, active, units(code))')
        .lt('quantity', 0)
      if (error) throw error
      const byItem = new Map()
      for (const row of data || []) {
        const item = row.inventory_items
        if (!item || !item.active) continue
        const cur = byItem.get(item.id) || { id: item.id, name: item.name, unit_id: item.unit_id, unit: item.units?.code, quantity: 0 }
        cur.quantity += Number(row.quantity)
        byItem.set(item.id, cur)
      }
      return [...byItem.values()]
    },
  })

  const placeholders = placeholdersQ.data || []
  if (!placeholders.length) return null

  async function merge(from) {
    const intoId = targets[from.id]
    const target = (itemsQ.data || []).find((i) => i.id === intoId)
    if (!target) return
    if (!window.confirm(`Merge "${from.name}" into "${target.name}"? Its stock and history move to "${target.name}", and "${from.name}" is retired.`)) return
    const { error } = await supabase.rpc('merge_inventory_item', { p_from_item: from.id, p_into_item: intoId })
    if (error) return toast.error(error.message)
    toast.success(`Merged into ${target.name}.`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['placeholder_items'] })
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
  }

  return (
    <Card title="Materials to link" className="mb-5">
      <p className="mb-3 text-xs text-ink-500">
        Created from job work and not yet matched to a stock item. Pick the item each one really is, and its stock and history move onto it.
      </p>
      <ul className="divide-y divide-ink-100">
        {placeholders.map((p) => {
          const options = (itemsQ.data || []).filter((i) => i.active && i.unit_id === p.unit_id && i.id !== p.id)
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink-950">{p.name}</div>
                <div className="tnum text-xs text-bad">{qty(Math.abs(p.quantity))} {p.unit} short</div>
              </div>
              <Select
                className="w-auto min-w-[14rem]"
                value={targets[p.id] || ''}
                onChange={(e) => setTargets({ ...targets, [p.id]: e.target.value })}
              >
                <option value="">This is actually…</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <button type="button" className="btn-secondary" disabled={!targets[p.id]} onClick={() => merge(p)}>Merge</button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function PurchaseModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const unitsQ = useUnits()
  const NEW = '__new__'
  const NEW_UNIT = '__new_unit__'
  const [form, setForm] = useState({ item_id: '', new_name: '', new_unit: 'SHEET', new_unit_name: '', quantity: '', unit_cost: '', date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)
  const creating = form.item_id === NEW

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { data: company, error: locErr } = await supabase.from('inventory_locations').select('id').eq('kind', 'company').single()
    if (locErr) { setSaving(false); return toast.error(locErr.message) }

    // A material that is not on the list yet is created here, in the unit chosen, then purchased.
    let itemId = form.item_id
    if (creating) {
      // A unit that is not in the list is added first, then used for the material.
      let unitCode = form.new_unit
      if (unitCode === NEW_UNIT) {
        const { data: unit, error: unitErr } = await supabase.rpc('add_inventory_unit', { p_name: form.new_unit_name })
        if (unitErr) { setSaving(false); return toast.error(unitErr.message) }
        unitCode = unit.code
        qc.invalidateQueries({ queryKey: ['units'] })
      }
      const { data: newId, error: createErr } = await supabase.rpc('ensure_inventory_item', {
        p_name: form.new_name, p_unit_code: unitCode,
      })
      if (createErr) { setSaving(false); return toast.error(createErr.message) }
      itemId = newId
    }

    const { error } = await supabase.rpc('record_inventory_purchase', {
      p_item_id: itemId, p_location_id: company.id, p_quantity: Number(form.quantity),
      p_unit_cost: Number(form.unit_cost), p_txn_date: form.date, p_reference_type: 'adjustment', p_reference_id: null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(creating ? `${form.new_name} added and purchase recorded.` : 'Purchase recorded.')
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">Record a direct purchase into company inventory</div>
        <Field label="Material">
          <Select required value={form.item_id} onChange={(e) => {
            const it = (itemsQ.data || []).find((i) => i.id === e.target.value)
            setForm({ ...form, item_id: e.target.value, unit_cost: it?.is_composite && it.default_rate ? String(it.default_rate) : form.unit_cost })
          }}>
            <option value="">Select…</option>
            {(itemsQ.data || []).filter((i) => i.active !== false).map((i) => <option key={i.id} value={i.id}>{i.name}{i.is_composite ? ' (composite)' : ''}{i.units ? ` (${i.units.name || i.units.code})` : ''}</option>)}
            <option value={NEW}>+ New material…</option>
          </Select>
        </Field>
        {creating && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="New material name">
                <Input required autoFocus value={form.new_name} onChange={(e) => setForm({ ...form, new_name: e.target.value })} placeholder="e.g. Century 18MM MR" />
              </Field>
            </div>
            <Field label="Unit">
              <Select value={form.new_unit} onChange={(e) => setForm({ ...form, new_unit: e.target.value })}>
                {(unitsQ.data || []).filter((u) => u.active !== false && u.inventory_unit).map((u) => <option key={u.id} value={u.code}>{u.name || u.code}</option>)}
                <option value={NEW_UNIT}>+ Add new unit…</option>
              </Select>
            </Field>
            {form.new_unit === NEW_UNIT && (
              <div className="col-span-3">
                <Field label="New unit name">
                  <Input required value={form.new_unit_name} onChange={(e) => setForm({ ...form, new_unit_name: e.target.value })} placeholder="e.g. Bag" />
                </Field>
              </div>
            )}
          </div>
        )}
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
