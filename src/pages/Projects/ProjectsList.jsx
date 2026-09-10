import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import ProjectFormModal from '../../components/ProjectFormModal'
import { useProjects } from '../../lib/queries'
import { deleteErrorMessage } from '../../lib/errors'
import { displayDate } from '../../lib/dates'

const STATUSES = ['draft', 'active', 'on_hold', 'completed', 'closed', 'cancelled']

export default function ProjectsList() {
  const projectsQ = useProjects()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [editing, setEditing] = useState(null) // null | 'new' | project row
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
  const filtered = filter ? projects.filter((p) => p.status === filter) : projects

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Every job-work entry belongs to a project."
        actions={canWrite && <button className="btn-primary" onClick={() => setEditing('new')}>+ New Project</button>}
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
        <ProjectFormModal
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  )
}
