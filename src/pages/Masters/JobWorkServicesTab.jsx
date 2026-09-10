import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { useJobWorkServices, useJobWorkComponents, useUnits, useProcesses } from '../../lib/queries'
import { deleteErrorMessage } from '../../lib/errors'

export default function JobWorkServicesTab() {
  const servicesQ = useJobWorkServices()
  const componentsQ = useJobWorkComponents()
  const units = useUnits()
  const processes = useProcesses()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [editing, setEditing] = useState(null)

  const services = servicesQ.data || []
  const components = componentsQ.data || []
  const atomicServices = services.filter((s) => !s.is_composite && s.active)

  const componentSummary = useMemo(() => {
    const map = {}
    for (const s of services) {
      if (!s.is_composite) continue
      const parts = components
        .filter((c) => c.service_id === s.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => {
          const cs = services.find((x) => x.id === c.component_service_id)
          return `${cs?.name || '?'} ×${c.multiplier}`
        })
      map[s.id] = parts.join(' + ')
    }
    return map
  }, [services, components])

  function startNew() {
    setEditing({ is_composite: false, active: true, code: '', name: '', unit_id: '', process_id: '', components: [] })
  }

  function startEdit(row) {
    setEditing({
      ...row,
      components: components
        .filter((c) => c.service_id === row.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({ component_service_id: c.component_service_id, multiplier: c.multiplier, id: c.id })),
    })
  }

  async function toggleActive(row) {
    const ok = await confirm(row.active ? `Deactivate "${row.name}"?` : `Reactivate "${row.name}"?`, {
      detail: row.active ? 'It can no longer be used for new job-work entries. Existing history is unaffected.' : undefined,
      tone: row.active ? 'danger' : 'primary',
      confirmLabel: row.active ? 'Deactivate' : 'Reactivate',
    })
    if (!ok) return
    const { error } = await supabase.from('job_work_services').update({ active: !row.active, updated_by: profile?.id }).eq('id', row.id)
    if (error) toast.error(error.message)
    else {
      toast.success('Updated.')
      qc.invalidateQueries({ queryKey: ['job_work_services'] })
    }
  }

  async function deleteService(row) {
    const ok = await confirm(`Delete "${row.name}" permanently?`, {
      detail: 'Only possible if it has no rates and no logged job-work yet. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    // A composite's own component rows are removed automatically (job_work_components.service_id
    // is ON DELETE CASCADE). An atomic service used inside a composite, or one with rates /
    // logged work, is blocked by its other foreign keys and reported as "in use".
    const { error } = await supabase.from('job_work_services').delete().eq('id', row.id)
    if (error) toast.error(deleteErrorMessage(error, `"${row.name}"`))
    else {
      toast.success('Deleted.')
      qc.invalidateQueries({ queryKey: ['job_work_services'] })
      qc.invalidateQueries({ queryKey: ['job_work_components'] })
    }
  }

  async function save(e) {
    e.preventDefault()
    if (editing.is_composite && editing.components.length === 0) {
      toast.error('A composite job-work must have at least one component.')
      return
    }
    const payload = {
      code: editing.code,
      name: editing.name,
      unit_id: editing.unit_id,
      is_composite: editing.is_composite,
      process_id: editing.is_composite ? null : editing.process_id || null,
      description: editing.description || null,
      active: editing.active !== false,
    }

    let serviceId = editing.id
    if (serviceId) {
      payload.updated_by = profile?.id
      const { error } = await supabase.from('job_work_services').update(payload).eq('id', serviceId)
      if (error) return toast.error(error.message)
    } else {
      payload.created_by = profile?.id
      const { data, error } = await supabase.from('job_work_services').insert(payload).select('id').single()
      if (error) return toast.error(error.message)
      serviceId = data.id
    }

    if (editing.is_composite) {
      // Replace the component set wholesale -- simplest correct approach for a small list.
      await supabase.from('job_work_components').delete().eq('service_id', serviceId)
      const rows = editing.components.map((c, i) => ({
        service_id: serviceId,
        component_service_id: c.component_service_id,
        multiplier: Number(c.multiplier) || 1,
        sort_order: i,
      }))
      const { error } = await supabase.from('job_work_components').insert(rows)
      if (error) return toast.error(error.message)
    }

    toast.success(editing.id ? 'Updated.' : 'Created.')
    setEditing(null)
    qc.invalidateQueries({ queryKey: ['job_work_services'] })
    qc.invalidateQueries({ queryKey: ['job_work_components'] })
  }

  function addComponentRow() {
    setEditing({ ...editing, components: [...editing.components, { component_service_id: '', multiplier: 1 }] })
  }
  function updateComponentRow(i, patch) {
    const next = editing.components.slice()
    next[i] = { ...next[i], ...patch }
    setEditing({ ...editing, components: next })
  }
  function removeComponentRow(i) {
    setEditing({ ...editing, components: editing.components.filter((_, idx) => idx !== i) })
  }

  return (
    <Card
      title="Job Work / Service Combinations"
      actions={<button className="btn-primary" onClick={startNew}>+ New Job Work</button>}
    >
      <p className="text-xs text-ink-500 mb-3">
        Atomic job-work items map to a machine/process and carry their own rate. Composite job-work items (what staff
        actually pick in the Daily Log) are built from one or more atomic items with a multiplier each — e.g.
        <span className="font-medium"> Double Side Cutting = Cutting ×1 + Pasting ×2</span>.
      </p>
      {servicesQ.isLoading ? (
        <LoadingBlock />
      ) : !services.length ? (
        <EmptyState title="No job-work services yet" />
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Type</th><th>Unit</th><th>Machine / Components</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className={!s.active ? 'opacity-50' : ''}>
                  <td className="font-mono text-xs">{s.code}</td>
                  <td className="font-medium">{s.name}</td>
                  <td><Badge tone={s.is_composite ? 'brand' : 'neutral'}>{s.is_composite ? 'Composite' : 'Atomic'}</Badge></td>
                  <td>{s.units?.name}</td>
                  <td className="text-xs">{s.is_composite ? componentSummary[s.id] || '—' : s.processes?.machines?.name}</td>
                  <td><Badge tone={s.active ? 'ok' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs px-2" onClick={() => startEdit(s)}>Edit</button>
                    <button className="btn-ghost text-xs px-2" onClick={() => toggleActive(s)}>
                      {s.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button className="btn-ghost text-xs px-2 text-bad" onClick={() => deleteService(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-semibold text-ink-900 mb-3">{editing.id ? 'Edit Job Work' : 'New Job Work'}</div>

            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={!editing.is_composite} onChange={() => setEditing({ ...editing, is_composite: false })} />
                Atomic (rate-bearing)
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={editing.is_composite} onChange={() => setEditing({ ...editing, is_composite: true })} />
                Composite (combination)
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Code *</label>
                <input className="field-input" required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Name *</label>
                <input className="field-input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Unit *</label>
                <select className="field-input" required value={editing.unit_id} onChange={(e) => setEditing({ ...editing, unit_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(units.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              {!editing.is_composite && (
                <div>
                  <label className="field-label">Process *</label>
                  <select className="field-input" required value={editing.process_id} onChange={(e) => setEditing({ ...editing, process_id: e.target.value })}>
                    <option value="">Select…</option>
                    {(processes.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.machines?.name})</option>)}
                  </select>
                </div>
              )}
            </div>

            {editing.is_composite && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="field-label mb-0">Components *</label>
                  <button type="button" className="btn-ghost text-xs px-2" onClick={addComponentRow}>+ Add component</button>
                </div>
                <div className="space-y-2">
                  {editing.components.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select
                        className="field-input flex-1"
                        required
                        value={c.component_service_id}
                        onChange={(e) => updateComponentRow(i, { component_service_id: e.target.value })}
                      >
                        <option value="">Select atomic service…</option>
                        {atomicServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input
                        className="field-input w-24"
                        type="number" min="0.0001" step="0.0001" required
                        placeholder="×"
                        value={c.multiplier}
                        onChange={(e) => updateComponentRow(i, { multiplier: e.target.value })}
                      />
                      <button type="button" className="btn-ghost text-bad px-2" onClick={() => removeComponentRow(i)}>✕</button>
                    </div>
                  ))}
                  {!editing.components.length && <div className="text-xs text-ink-400">No components added yet.</div>}
                </div>
              </div>
            )}

            <div className="mt-3">
              <label className="field-label">Description</label>
              <textarea className="field-input" rows={2} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </Card>
  )
}
