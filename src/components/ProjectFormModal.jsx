import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { useAuth } from '../context/AuthContext'
import { useClients, useRateCategories } from '../lib/queries'
import { today } from '../lib/dates'
import ClientFormModal from './ClientFormModal'

// Shared new/edit-project modal. Used by the Projects page and, inline, from the Daily Log so
// a project can be created without navigating away. Contains its own "+ New client" shortcut.
// onSaved receives the created/updated project row.
const STATUSES = ['draft', 'active', 'on_hold', 'completed', 'closed', 'cancelled']
const blank = { code: '', name: '', client_id: '', rate_category_id: '', start_date: today(), expected_completion_date: '', status: 'draft', notes: '' }

export default function ProjectFormModal({ existing, onClose, onSaved }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const clientsQ = useClients()
  const categories = (useRateCategories().data || []).filter((c) => c.active)
  const clients = (clientsQ.data || []).filter((c) => c.active)
  const [form, setForm] = useState(existing ? { ...blank, ...existing } : blank)
  const [saving, setSaving] = useState(false)
  const [addingClient, setAddingClient] = useState(false)

  function onClientChange(clientId) {
    const client = clients.find((c) => c.id === clientId)
    setForm((f) => ({ ...f, client_id: clientId, rate_category_id: f.rate_category_id || client?.default_rate_category_id || '' }))
  }

  async function onClientCreated(client) {
    setAddingClient(false)
    await qc.invalidateQueries({ queryKey: ['clients'] })
    setForm((f) => ({ ...f, client_id: client.id, rate_category_id: f.rate_category_id || client.default_rate_category_id || '' }))
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      code: form.code, name: form.name, client_id: form.client_id, rate_category_id: form.rate_category_id,
      start_date: form.start_date, expected_completion_date: form.expected_completion_date || null,
      status: form.status, notes: form.notes || null,
    }
    let data, error
    if (existing?.id) {
      payload.updated_by = profile?.id
      ;({ data, error } = await supabase.from('projects').update(payload).eq('id', existing.id).select().single())
    } else {
      payload.created_by = profile?.id
      ;({ data, error } = await supabase.from('projects').insert(payload).select().single())
    }
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(existing?.id ? 'Project updated.' : 'Project created.')
    qc.invalidateQueries({ queryKey: ['projects'] })
    onSaved?.(data)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <form onSubmit={save} className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="text-sm font-semibold text-ink-900 mb-3">{existing?.id ? 'Edit Project' : 'New Project'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="field-label">Code *</label><input className="field-input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="field-label">Name *</label><input className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <label className="field-label mb-0">Client *</label>
                <button type="button" className="btn-ghost text-xs px-2 text-brand-700" onClick={() => setAddingClient(true)}>+ New client</button>
              </div>
              <select className="field-input" required value={form.client_id} onChange={(e) => onClientChange(e.target.value)}>
                <option value="">Select…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="field-label">Rate Category * <span className="text-ink-400 font-normal">(defaults from client, overridable)</span></label>
              <select className="field-input" required value={form.rate_category_id} onChange={(e) => setForm({ ...form, rate_category_id: e.target.value })}>
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="field-label">Start Date *</label><input className="field-input" type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><label className="field-label">Expected Completion</label><input className="field-input" type="date" value={form.expected_completion_date} onChange={(e) => setForm({ ...form, expected_completion_date: e.target.value })} /></div>
            <div className="col-span-2">
              <label className="field-label">Status</label>
              <select className="field-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
      {addingClient && (
        <ClientFormModal existing={null} onClose={() => setAddingClient(false)} onSaved={onClientCreated} />
      )}
    </>
  )
}
