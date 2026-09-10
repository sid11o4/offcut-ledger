import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { useClients, useRateCategories } from '../../lib/queries'
import { deleteErrorMessage } from '../../lib/errors'

export default function ClientsList() {
  const clientsQ = useClients()
  const categoriesQ = useRateCategories()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile, hasPermission } = useAuth()
  const [editing, setEditing] = useState(null)
  const canWrite = hasPermission('project_manage')

  const clients = clientsQ.data || []
  const categories = categoriesQ.data || []

  function categoryName(id) { return categories.find((c) => c.id === id)?.name || '—' }

  function startNew() {
    setEditing({ code: '', name: '', contact_person: '', phone: '', email: '', address: '', gst_number: '', default_rate_category_id: '', notes: '', active: true })
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      code: editing.code, name: editing.name, contact_person: editing.contact_person || null,
      phone: editing.phone || null, email: editing.email || null, address: editing.address || null,
      gst_number: editing.gst_number || null, default_rate_category_id: editing.default_rate_category_id || null,
      notes: editing.notes || null, active: editing.active !== false,
    }
    let error
    if (editing.id) {
      payload.updated_by = profile?.id
      ;({ error } = await supabase.from('clients').update(payload).eq('id', editing.id))
    } else {
      payload.created_by = profile?.id
      ;({ error } = await supabase.from('clients').insert(payload))
    }
    if (error) return toast.error(error.message)
    toast.success(editing.id ? 'Client updated.' : 'Client created.')
    setEditing(null)
    qc.invalidateQueries({ queryKey: ['clients'] })
  }

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
        actions={canWrite && <button className="btn-primary" onClick={startNew}>+ New Client</button>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-semibold text-ink-900 mb-3">{editing.id ? 'Edit Client' : 'New Client'}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="field-label">Code *</label><input className="field-input" required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><label className="field-label">Name *</label><input className="field-input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><label className="field-label">Contact Person</label><input className="field-input" value={editing.contact_person} onChange={(e) => setEditing({ ...editing, contact_person: e.target.value })} /></div>
              <div><label className="field-label">Phone</label><input className="field-input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
              <div><label className="field-label">Email</label><input className="field-input" type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              <div><label className="field-label">GST Number</label><input className="field-input" value={editing.gst_number} onChange={(e) => setEditing({ ...editing, gst_number: e.target.value })} /></div>
              <div className="col-span-2"><label className="field-label">Address</label><textarea className="field-input" rows={2} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
              <div className="col-span-2">
                <label className="field-label">Default Rate Category *</label>
                <select className="field-input" required value={editing.default_rate_category_id} onChange={(e) => setEditing({ ...editing, default_rate_category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
