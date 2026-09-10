import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { useProjects, useClients, useRateCategories } from '../../lib/queries'
import { deleteErrorMessage } from '../../lib/errors'
import { displayDate, today } from '../../lib/dates'

const STATUSES = ['draft', 'active', 'on_hold', 'completed', 'closed', 'cancelled']

export default function ProjectsList() {
  const projectsQ = useProjects()
  const clientsQ = useClients()
  const categoriesQ = useRateCategories()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile, hasPermission } = useAuth()
  const [editing, setEditing] = useState(null)
  const [filter, setFilter] = useState('')
  const canWrite = hasPermission('project_manage')

  async function deleteProject(row) {
    const ok = await confirm(`Delete "${row.name}" permanently?`, {
      detail: 'Only possible if it has no job-work, bills, estimates or expenses. This cannot be undone.',
      tone: 'danger', confirmLabel: 'Delete',
    })
    if (!ok) return
    const { error } = await supabase.from('projects').delete().eq('id', row.id)
    if (error) toast.error(deleteErrorMessage(error, `"${row.name}"`))
    else { toast.success('Deleted.'); qc.invalidateQueries({ queryKey: ['projects'] }) }
  }

  const projects = projectsQ.data || []
  const clients = (clientsQ.data || []).filter((c) => c.active)
  const filtered = filter ? projects.filter((p) => p.status === filter) : projects

  function startNew() {
    setEditing({ code: '', name: '', client_id: '', rate_category_id: '', start_date: today(), expected_completion_date: '', status: 'draft', notes: '' })
  }

  function onClientChange(clientId) {
    const client = clients.find((c) => c.id === clientId)
    setEditing({ ...editing, client_id: clientId, rate_category_id: editing.rate_category_id || client?.default_rate_category_id || '' })
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      code: editing.code, name: editing.name, client_id: editing.client_id, rate_category_id: editing.rate_category_id,
      start_date: editing.start_date, expected_completion_date: editing.expected_completion_date || null,
      status: editing.status, notes: editing.notes || null,
    }
    let error
    if (editing.id) {
      payload.updated_by = profile?.id
      ;({ error } = await supabase.from('projects').update(payload).eq('id', editing.id))
    } else {
      payload.created_by = profile?.id
      ;({ error } = await supabase.from('projects').insert(payload))
    }
    if (error) return toast.error(error.message)
    toast.success(editing.id ? 'Project updated.' : 'Project created.')
    setEditing(null)
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Every job-work entry belongs to a project."
        actions={canWrite && <button className="btn-primary" onClick={startNew}>+ New Project</button>}
      />
      <div className="flex gap-1 mb-3">
        <button onClick={() => setFilter('')} className={`btn-ghost text-xs ${!filter ? 'bg-ink-100' : ''}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`btn-ghost text-xs capitalize ${filter === s ? 'bg-ink-100' : ''}`}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <Card>
        {projectsQ.isLoading ? <LoadingBlock /> : !filtered.length ? (
          <EmptyState title="No projects" hint={canWrite ? 'Use "+ New Project" to add one.' : undefined} />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Code</th><th>Project</th><th>Client</th><th>Rate Category</th><th>Start</th><th>Status</th>{canWrite && <th></th>}</tr></thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.code}</td>
                    <td><Link to={`/projects/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link></td>
                    <td>{p.clients?.name}</td>
                    <td>{p.rate_categories?.name}</td>
                    <td>{displayDate(p.start_date)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    {canWrite && (
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs px-2" onClick={() => setEditing(p)}>Edit</button>
                        <button className="btn-ghost text-xs px-2 text-bad" onClick={() => deleteProject(p)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-semibold text-ink-900 mb-3">{editing.id ? 'Edit Project' : 'New Project'}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="field-label">Code *</label><input className="field-input" required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><label className="field-label">Name *</label><input className="field-input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="col-span-2">
                <label className="field-label">Client *</label>
                <select className="field-input" required value={editing.client_id} onChange={(e) => onClientChange(e.target.value)}>
                  <option value="">Select…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="field-label">Rate Category * <span className="text-ink-400 font-normal">(defaults from client, overridable)</span></label>
                <select className="field-input" required value={editing.rate_category_id} onChange={(e) => setEditing({ ...editing, rate_category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(categoriesQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="field-label">Start Date *</label><input className="field-input" type="date" required value={editing.start_date} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
              <div><label className="field-label">Expected Completion</label><input className="field-input" type="date" value={editing.expected_completion_date} onChange={(e) => setEditing({ ...editing, expected_completion_date: e.target.value })} /></div>
              <div className="col-span-2">
                <label className="field-label">Status</label>
                <select className="field-input" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="col-span-2"><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
