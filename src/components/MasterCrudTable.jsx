import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { useConfirm } from './ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { Card, Badge, EmptyState, LoadingBlock } from './ui'
import { deleteErrorMessage } from '../lib/errors'

// Generic CRUD table for masters shaped like {code, name, description, active, ...extraFields}.
// Never hard-deletes (spec: historical transactions must survive master changes) -- "delete"
// here always means setting active=false, and everything stays visible with a status badge.
export default function MasterCrudTable({
  table,
  queryKey,
  title,
  fields, // [{name, label, type: 'text'|'select'|'number', options, required, render}]
  query,
  canWrite = true,
}) {
  const { data: rows, isLoading } = query
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [editing, setEditing] = useState(null) // row object or {} for new
  const [saving, setSaving] = useState(false)

  function startNew() {
    const blank = { active: true }
    for (const f of fields) blank[f.name] = f.default ?? ''
    setEditing(blank)
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {}
    for (const f of fields) payload[f.name] = editing[f.name]
    payload.active = editing.active !== false

    let error
    if (editing.id) {
      payload.updated_by = profile?.id
      ;({ error } = await supabase.from(table).update(payload).eq('id', editing.id))
    } else {
      payload.created_by = profile?.id
      ;({ error } = await supabase.from(table).insert(payload))
    }
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(editing.id ? 'Updated.' : 'Created.')
    setEditing(null)
    qc.invalidateQueries({ queryKey })
  }

  async function toggleActive(row) {
    const ok = await confirm(
      row.active ? `Deactivate "${row.name}"?` : `Reactivate "${row.name}"?`,
      {
        detail: row.active
          ? 'It will no longer be selectable for new records, but history referencing it is unaffected.'
          : undefined,
        tone: row.active ? 'danger' : 'primary',
        confirmLabel: row.active ? 'Deactivate' : 'Reactivate',
      },
    )
    if (!ok) return
    const { error } = await supabase
      .from(table)
      .update({ active: !row.active, updated_by: profile?.id })
      .eq('id', row.id)
    if (error) toast.error(error.message)
    else {
      toast.success(row.active ? 'Deactivated.' : 'Reactivated.')
      qc.invalidateQueries({ queryKey })
    }
  }

  async function deleteRow(row) {
    const ok = await confirm(`Delete "${row.name}" permanently?`, {
      detail: 'Only possible if nothing references it yet. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const { error } = await supabase.from(table).delete().eq('id', row.id)
    if (error) toast.error(deleteErrorMessage(error, `"${row.name}"`))
    else {
      toast.success('Deleted.')
      qc.invalidateQueries({ queryKey })
    }
  }

  return (
    <Card
      title={title}
      actions={canWrite && <button className="btn-primary" onClick={startNew}>+ Add</button>}
    >
      {isLoading ? (
        <LoadingBlock />
      ) : !rows?.length ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} hint={canWrite ? 'Use "+ Add" to create one.' : undefined} />
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                {fields.filter((f) => f.name !== 'code' && f.name !== 'name').map((f) => (
                  <th key={f.name}>{f.label}</th>
                ))}
                <th>Status</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={!row.active ? 'opacity-50' : ''}>
                  <td className="font-mono text-xs">{row.code}</td>
                  <td className="font-medium">{row.name}</td>
                  {fields.filter((f) => f.name !== 'code' && f.name !== 'name').map((f) => (
                    <td key={f.name}>{f.render ? f.render(row) : row[f.name] || '—'}</td>
                  ))}
                  <td><Badge tone={row.active ? 'ok' : 'neutral'}>{row.active ? 'Active' : 'Inactive'}</Badge></td>
                  {canWrite && (
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs px-2" onClick={() => setEditing(row)}>Edit</button>
                      <button className="btn-ghost text-xs px-2" onClick={() => toggleActive(row)}>
                        {row.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button className="btn-ghost text-xs px-2 text-bad" onClick={() => deleteRow(row)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-semibold text-ink-900 mb-3">
              {editing.id ? `Edit ${title.slice(0, -1)}` : `New ${title.slice(0, -1)}`}
            </div>
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.name}>
                  <label className="field-label">{f.label}{f.required && ' *'}</label>
                  {f.type === 'select' ? (
                    <select
                      className="field-input"
                      required={f.required}
                      value={editing[f.name] ?? ''}
                      onChange={(e) => setEditing({ ...editing, [f.name]: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      className="field-input"
                      rows={2}
                      value={editing[f.name] ?? ''}
                      onChange={(e) => setEditing({ ...editing, [f.name]: e.target.value })}
                    />
                  ) : (
                    <input
                      className="field-input"
                      type={f.type === 'number' ? 'number' : 'text'}
                      step={f.step}
                      required={f.required}
                      value={editing[f.name] ?? ''}
                      onChange={(e) => setEditing({ ...editing, [f.name]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </Card>
  )
}
