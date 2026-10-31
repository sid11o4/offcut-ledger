import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock, Field, Input, Select } from '../../components/ui'
import { useDesignProjectsSummary, useClients, useProjects } from '../../lib/queries'
import { money } from '../../lib/format'

export default function DesignProjectsList() {
  const summaryQ = useDesignProjectsSummary()
  const { hasPermission } = useAuth()
  const [creating, setCreating] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const canWrite = hasPermission('design_build_manage')

  // Completed projects leave the list unless asked for; their stock has moved to Company inventory.
  const rows = (summaryQ.data || []).filter((p) => showCompleted || p.status !== 'completed')

  return (
    <div>
      <PageHeader
        title="Design Build Projects"
        subtitle="Turnkey interior projects — inventory, supplier bills, and Internal Order job-work all roll up here."
        actions={(
          <>
            <button className="btn-ghost" onClick={() => setShowCompleted((v) => !v)}>
              {showCompleted ? 'Hide completed' : 'Show completed'}
            </button>
            {canWrite && <button className="btn-primary" onClick={() => setCreating(true)}>+ New Project</button>}
          </>
        )}
      />
      <Card>
        {summaryQ.isLoading ? <LoadingBlock /> : !rows.length ? (
          <EmptyState title="No Design Build projects yet" hint={canWrite ? 'Use "+ New Project" to add one.' : undefined} />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Code</th><th>Project</th><th>Status</th>
                  <th className="num">Budget</th><th className="num">Supplier Bills</th>
                  <th className="num">Internal Order</th><th className="num">Inventory on hand</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs text-ink-500">{p.code}</td>
                    <td><Link to={`/design-build/projects/${p.id}`} className="font-medium text-ink-950 hover:underline">{p.name}</Link></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="num">{p.budget ? money(p.budget) : <span className="text-ink-400">—</span>}</td>
                    <td className="num">{money(p.supplier_bills_total)}</td>
                    <td className="num">{money(p.internal_order_total)}</td>
                    <td className="num">{money(p.current_inventory_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewProjectModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const clientsQ = useClients()
  const projectsQ = useProjects()
  const [form, setForm] = useState({ code: '', name: '', client_id: '', factory_project_id: '', budget: '', start_date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.code || !form.name) return toast.error('Code and name are required.')
    setSaving(true)
    const { error } = await supabase.from('design_projects').insert({
      code: form.code, name: form.name,
      client_id: form.client_id || null,
      factory_project_id: form.factory_project_id || null,
      budget: form.budget ? Number(form.budget) : null,
      start_date: form.start_date,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Design Build project created.')
    qc.invalidateQueries({ queryKey: ['design_projects_summary'] })
    qc.invalidateQueries({ queryKey: ['design_projects'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">New Design Build project</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SAN-U02" /></Field>
          <Field label="Start date"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
        </div>
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sanctum Residence — Unit 02" /></Field>
        <Field label="Client">
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">—</option>
            {(clientsQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Factory project (for Internal Order job-work)" hint="Links this project to a Factory-side project so Internal Order billing posts material consumption here automatically.">
          <Select value={form.factory_project_id} onChange={(e) => setForm({ ...form, factory_project_id: e.target.value })}>
            <option value="">— none yet —</option>
            {(projectsQ.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Budget"><Input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  )
}
