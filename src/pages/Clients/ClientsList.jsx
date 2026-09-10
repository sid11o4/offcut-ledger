import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import ClientFormModal from '../../components/ClientFormModal'
import { useClients, useRateCategories } from '../../lib/queries'
import { deleteErrorMessage } from '../../lib/errors'

export default function ClientsList() {
  const clientsQ = useClients()
  const categoriesQ = useRateCategories()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile, hasPermission } = useAuth()
  const [editing, setEditing] = useState(null) // null | 'new' | client row
  const canWrite = hasPermission('project_manage')

  const clients = clientsQ.data || []
  const categories = categoriesQ.data || []

  function categoryName(id) { return categories.find((c) => c.id === id)?.name || '—' }

  async function toggleActive(row) {
    const ok = await confirm(row.active ? `Deactivate "${row.name}"?` : `Reactivate "${row.name}"?`, {
      tone: row.active ? 'danger' : 'primary', confirmLabel: row.active ? 'Deactivate' : 'Reactivate',
    })
    if (!ok) return
    const { error } = await supabase.from('clients').update({ active: !row.active, updated_by: profile?.id }).eq('id', row.id)
    if (error) toast.error(error.message)
    else { toast.success('Updated.'); qc.invalidateQueries({ queryKey: ['clients'] }) }
  }

  async function deleteClient(row) {
    const ok = await confirm(`Delete "${row.name}" permanently?`, {
      detail: 'Only possible if it has no projects. This cannot be undone.',
      tone: 'danger', confirmLabel: 'Delete',
    })
    if (!ok) return
    const { error } = await supabase.from('clients').delete().eq('id', row.id)
    if (error) toast.error(deleteErrorMessage(error, `"${row.name}"`))
    else { toast.success('Deleted.'); qc.invalidateQueries({ queryKey: ['clients'] }) }
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Client/customer master. Projects inherit a client's default rate category unless overridden."
        actions={canWrite && <button className="btn-primary" onClick={() => setEditing('new')}>+ New Client</button>}
      />
      <Card>
        {clientsQ.isLoading ? <LoadingBlock /> : !clients.length ? (
          <EmptyState title="No clients yet" hint={canWrite ? 'Use "+ New Client" to add one.' : undefined} />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Contact</th><th>Phone</th><th>Default Rate Category</th><th>Status</th>{canWrite && <th></th>}</tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className={!c.active ? 'opacity-50' : ''}>
                    <td className="font-mono text-xs">{c.code}</td>
                    <td className="font-medium">{c.name}</td>
                    <td>{c.contact_person || '—'}</td>
                    <td>{c.phone || '—'}</td>
                    <td>{categoryName(c.default_rate_category_id)}</td>
                    <td><Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
                    {canWrite && (
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs px-2" onClick={() => setEditing(c)}>Edit</button>
                        <button className="btn-ghost text-xs px-2" onClick={() => toggleActive(c)}>{c.active ? 'Deactivate' : 'Reactivate'}</button>
                        <button className="btn-ghost text-xs px-2 text-bad" onClick={() => deleteClient(c)}>Delete</button>
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
        <ClientFormModal
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  )
}
