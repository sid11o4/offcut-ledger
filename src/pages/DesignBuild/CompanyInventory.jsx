import { Fragment, useState } from 'react'
import MaterialSources from './MaterialSources'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock, Field, Input, Select, Badge } from '../../components/ui'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompanyInventoryValue, useInventoryItems, useDesignProjectsSummary, useUnits, invalidateInventory } from '../../lib/queries'
import { money, qty } from '../../lib/format'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import TransferModal from '../../components/TransferModal'
import MergeItemsModal from '../../components/MergeItemsModal'
import CompositeModal, { CompositeBreakdown, MakeCompositeModal, useCompositeValues } from './CompositeModal'

// The inventory is split into these groups; a material with no category counts as Others, and
// composite materials form their own group.
export const INVENTORY_CATEGORIES = ['Raw Boards', 'Skins', 'Edgeband', 'Hardware', 'Others']
const GROUPS = [...INVENTORY_CATEGORIES, 'Composite']

export default function CompanyInventory() {
  // /design-build/inventory?project=<id> shows that project's own stock; without it, the company pool.
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const companyQ = useCompanyInventoryValue()
  const projectStockQ = useQuery({
    queryKey: ['design_project_stock_list', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data: loc, error: locErr } = await supabase.from('inventory_locations').select('id').eq('design_project_id', projectId).maybeSingle()
      if (locErr) throw locErr
      if (!loc) return []
      const { data, error } = await supabase.from('inventory_stock')
        .select('item_id, quantity, avg_unit_cost, inventory_items(name)').eq('location_id', loc.id).neq('quantity', 0)
      if (error) throw error
      return (data || []).map((r) => ({
        item_id: r.item_id, item_name: r.inventory_items?.name, quantity: Number(r.quantity),
        avg_unit_cost: Number(r.avg_unit_cost), value: Number(r.quantity) * Number(r.avg_unit_cost),
      }))
    },
  })
  const projectLocQ = useQuery({
    queryKey: ['design_project_location', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_locations').select('id').eq('design_project_id', projectId).maybeSingle()
      if (error) throw error
      return data?.id || null
    },
  })
  const valueQ = projectId ? projectStockQ : companyQ
  const companyTotal = (companyQ.data || []).reduce((sum, r) => sum + Number(r.value), 0)
  const itemsQ = useInventoryItems()
  // Each material's unit, to show beside its quantity.
  const unitOf = new Map((itemsQ.data || []).map((i) => [i.id, i.units?.name || i.units?.code]))
  const projectsQ = useDesignProjectsSummary()
  const { hasPermission } = useAuth()
  const qc = useQueryClient()
  const [transferOpen, setTransferOpen] = useState(false)
  const [openItem, setOpenItem] = useState(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [mergeItem, setMergeItem] = useState(null) // the item whose Merge button was clicked
  const [compositeOpen, setCompositeOpen] = useState(false)
  const [editComposite, setEditComposite] = useState(null)
  const [makeOpen, setMakeOpen] = useState(false)
  const [group, setGroup] = useState('All')
  const toast = useToast()
  const canOperate = hasPermission('inventory_operate')
  const currentProject = (projectsQ.data || []).find((p) => p.id === projectId)

  const rows = valueQ.data || []
  const valuesQ = useCompositeValues()
  const compositeItems = (itemsQ.data || []).filter((i) => i.is_composite && i.active !== false)
  const compositeIds = new Set((itemsQ.data || []).filter((i) => i.is_composite).map((i) => i.id))
  // A component's cost for the composite form: its average cost in the pool, else its default rate.
  const costOf = (id) => Number(rows.find((r) => r.item_id === id)?.avg_unit_cost || (itemsQ.data || []).find((i) => i.id === id)?.default_rate || 0)
  const total = rows.reduce((s, r) => s + Number(r.value), 0)
  const itemById = new Map((itemsQ.data || []).map((i) => [i.id, i]))
  const groupOf = (itemId) => {
    const it = itemById.get(itemId)
    return it?.is_composite ? 'Composite' : (it?.category || 'Others')
  }
  const groupStats = Object.fromEntries(GROUPS.map((g) => {
    const inGroup = rows.filter((r) => groupOf(r.item_id) === g)
    return [g, { count: inGroup.length, value: inGroup.reduce((s, r) => s + Number(r.value), 0) }]
  }))
  const shownRows = (group === 'All' ? [...rows] : rows.filter((r) => groupOf(r.item_id) === group))
    .sort((a, b) => GROUPS.indexOf(groupOf(a.item_id)) - GROUPS.indexOf(groupOf(b.item_id)) || String(a.item_name).localeCompare(String(b.item_name)))

  async function changeCategory(itemId, category) {
    const { error } = await supabase.rpc('set_inventory_category', { p_item_id: itemId, p_category: category })
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['inventory_items'] })
  }

  return (
    <div>
      <PageHeader
        title={projectId ? `${currentProject?.name || 'Project'} Inventory` : 'Company Inventory'}
        subtitle={projectId
          ? "This project's own stock. Stock reaches it by transfer from the company pool or a direct purchase; the cost moves with it."
          : "The shared pool. Transferred to a project's own inventory on request; the cost moves with it."}
        actions={(
          <>
            {projectId && <Link className="btn-secondary" to={`/design-build/projects/${projectId}`}>Project page</Link>}
            {canOperate && (
              <>
                <button className="btn-secondary" onClick={() => setCompositeOpen(true)}>New composite material</button>
                {!projectId && <button className="btn-secondary" onClick={() => setMakeOpen(true)}>Make composite</button>}
                <button className="btn-secondary" onClick={() => setTransferOpen(true)}>Transfer</button>
                <button className="btn-primary" onClick={() => setPurchaseOpen(true)}>Record purchase</button>
              </>
            )}
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Link to="/design-build/inventory" className={`card p-4 block hover:bg-ink-50 ${!projectId ? 'ring-2 ring-brand-600' : ''}`}>
          <div className="text-xs text-ink-500">Company Inventory</div>
          <div className="text-2xl font-medium tnum mt-1">{money(companyTotal)}</div>
          <div className="text-xs text-ink-500 mt-1">{(companyQ.data || []).length} material{(companyQ.data || []).length === 1 ? '' : 's'} in the shared pool</div>
        </Link>
        {(projectsQ.data || []).filter((p) => p.status !== 'completed' || p.id === projectId).map((p) => (
          <Link key={p.id} to={`/design-build/inventory?project=${p.id}`} className={`card p-4 hover:bg-ink-50 block ${p.id === projectId ? 'ring-2 ring-brand-600' : ''}`}>
            <div className="text-xs text-ink-500 font-mono">{p.code}</div>
            <div className="font-medium text-ink-950 mt-0.5">{p.name}</div>
            <div className="text-2xl font-medium tnum mt-2">{money(p.id === projectId ? total : p.current_inventory_value)}</div>
            <div className="text-xs text-ink-500 mt-1">Project warehouse</div>
          </Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {['All', ...GROUPS].map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className={group === g ? 'btn-primary' : 'btn-secondary'}
          >
            {g}{g !== 'All' && <span className="ml-1.5 tnum opacity-70">{groupStats[g].count}</span>}
          </button>
        ))}
      </div>
      {group !== 'All' && (
        <div className="mb-3 text-sm text-ink-700">{group}: <span className="tnum font-medium text-ink-950">{money(groupStats[group].value)}</span> in stock</div>
      )}

      <Card>
        {valueQ.isLoading ? <LoadingBlock /> : !shownRows.length ? (
          <EmptyState title={projectId ? 'No stock at this project' : 'No stock in the company pool'} hint={!projectId && canOperate ? 'Record a purchase to add material.' : undefined} />
        ) : (
          <table className="table-base">
            <thead><tr><th>Material</th><th>Category</th><th className="num">Quantity</th><th>Unit</th><th className="num">Avg cost</th><th className="num">Value</th><th className="num"></th></tr></thead>
            <tbody>
              {shownRows.map((r, idx) => {
                const short = r.quantity < 0
                const low = !short && r.quantity < 10
                const g = groupOf(r.item_id)
                const startsGroup = idx === 0 || groupOf(shownRows[idx - 1].item_id) !== g
                return (
                  <Fragment key={r.item_id}>
                    {startsGroup && (
                      <tr className="bg-ink-50">
                        <td colSpan={7} className="!py-2 text-xs font-semibold uppercase tracking-wide text-ink-700">
                          {g}
                          <span className="ml-2 font-normal normal-case tracking-normal text-ink-500">
                            {groupStats[g].count} material{groupStats[g].count === 1 ? '' : 's'} · <span className="tnum">{money(groupStats[g].value)}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr className="cursor-pointer" onClick={() => setOpenItem(openItem === r.item_id ? null : r.item_id)}>
                      <td>{r.item_name} {compositeIds.has(r.item_id) && <Badge tone="brand">Composite</Badge>} <span className="text-xs text-ink-500">{openItem === r.item_id ? '· hide details' : '· details'}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {compositeIds.has(r.item_id) ? <span className="text-ink-500">Composite</span> : canOperate ? (
                          <Select className="w-auto min-w-[8rem]" value={itemById.get(r.item_id)?.category || ''} onChange={(e) => changeCategory(r.item_id, e.target.value)}>
                            <option value="">Others</option>
                            {INVENTORY_CATEGORIES.filter((c) => c !== 'Others').map((c) => <option key={c} value={c}>{c}</option>)}
                          </Select>
                        ) : <span className="text-ink-500">{itemById.get(r.item_id)?.category || 'Others'}</span>}
                      </td>
                      <td className={`num ${r.quantity < 0 ? 'text-bad' : ''}`}>{qty(r.quantity)}</td>
                      <td>{unitOf.get(r.item_id) || '—'}</td>
                      <td className="num">{money(r.avg_unit_cost)}</td>
                      <td className="num font-medium">{money(r.value)}</td>
                      <td className="num whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {short && <Badge tone="bad">Short</Badge>}{low && <Badge tone="warn">Low</Badge>}
                        {canOperate && !compositeIds.has(r.item_id) && <button type="button" className="btn-ghost text-xs px-1.5 ml-1" title="Merge with another item" onClick={() => setMergeItem((itemsQ.data || []).find((i) => i.id === r.item_id))}>Merge</button>}
                      </td>
                    </tr>
                    {openItem === r.item_id && (
                      <tr>
                        <td colSpan={7} className="bg-ink-50">
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

      <Card title="Composite materials" className="mb-5">
        {!compositeItems.length ? (
          <EmptyState title="No composite materials yet" hint={canOperate ? 'Use New composite material to set one up.' : undefined} />
        ) : (
          <table className="table-base">
            <thead><tr><th>Raw board / Skin 1 / Skin 2</th><th className="num">In stock</th><th className="num">Value per unit</th><th className="num"></th></tr></thead>
            <tbody>
              {compositeItems.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">{qty(rows.find((r) => r.item_id === c.id)?.quantity || 0)}</td>
                  <td className="num">{money(valuesQ.data?.get(c.id) ?? c.default_rate ?? 0)}</td>
                  <td className="num">{canOperate && <button type="button" className="btn-ghost text-xs" onClick={() => setEditComposite(c)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canOperate && <LinkPlaceholders />}

      {transferOpen && (
        <TransferModal
          designProjectId={projectId || undefined}
          onClose={() => setTransferOpen(false)}
          onSaved={() => { invalidateInventory(qc); setTransferOpen(false) }}
        />
      )}
      {mergeItem && <MergeItemsModal item={mergeItem} onClose={() => setMergeItem(null)} />}
      {purchaseOpen && <PurchaseModal locationId={projectId ? projectLocQ.data : null} onClose={() => setPurchaseOpen(false)} />}
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

function PurchaseModal({ onClose, locationId = null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const valuesQ = useCompositeValues()
  const unitsQ = useUnits()
  const NEW = '__new__'
  const NEW_UNIT = '__new_unit__'
  const [form, setForm] = useState({ item_id: '', new_name: '', new_category: '', new_unit: 'SHEET', new_unit_name: '', quantity: '', unit_cost: '', date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)
  const creating = form.item_id === NEW

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    // Into the company pool, or straight into a project's own stock when opened from a project's inventory.
    let company = { id: locationId }
    if (!locationId) {
      const { data, error: locErr } = await supabase.from('inventory_locations').select('id').eq('kind', 'company').single()
      if (locErr) { setSaving(false); return toast.error(locErr.message) }
      company = data
    }

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
        p_name: form.new_name, p_unit_code: unitCode, p_category: form.new_category || null,
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
        <div className="text-sm font-semibold text-ink-950">{locationId ? "Record a direct purchase into this project's inventory" : 'Record a direct purchase into company inventory'}</div>
        <Field label="Material">
          <Select required value={form.item_id} onChange={(e) => {
            const it = (itemsQ.data || []).find((i) => i.id === e.target.value)
            setForm({ ...form, item_id: e.target.value, unit_cost: it?.is_composite && (valuesQ.data?.get(it.id) || it.default_rate) ? String(valuesQ.data?.get(it.id) || it.default_rate) : form.unit_cost })
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
            <Field label="Category">
              <Select value={form.new_category} onChange={(e) => setForm({ ...form, new_category: e.target.value })}>
                <option value="">Others</option>
                {INVENTORY_CATEGORIES.filter((c) => c !== 'Others').map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
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
