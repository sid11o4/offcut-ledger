import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { useAuth } from '../context/AuthContext'
import { useRateCategories } from '../lib/queries'

// Shared new/edit-client modal. Used by the Clients page and, inline, wherever a client needs
// to be created without leaving the current screen (the new-project modal, etc.).
// onSaved receives the created/updated client row.
const blank = { code: '', name: '', contact_person: '', phone: '', email: '', address: '', gst_number: '', default_rate_category_id: '', notes: '', active: true }

export default function ClientFormModal({ existing, onClose, onSaved }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const categories = (useRateCategories().data || []).filter((c) => c.active)
  const [form, setForm] = useState(existing ? { ...blank, ...existing } : blank)
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      code: form.code, name: form.name, contact_person: form.contact_person || null,
      phone: form.phone || null, email: form.email || null, address: form.address || null,
      gst_number: form.gst_number || null, default_rate_category_id: form.default_rate_category_id || null,
      notes: form.notes || null, active: form.active !== false,
    }
    let data, error
    if (existing?.id) {
      payload.updated_by = profile?.id
      ;({ data, error } = await supabase.from('clients').update(payload).eq('id', existing.id).select().single())
    } else {
      payload.created_by = profile?.id
      ;({ data, error } = await supabase.from('clients').insert(payload).select().single())
    }
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(existing?.id ? 'Client updated.' : 'Client created.')
    qc.invalidateQueries({ queryKey: ['clients'] })
    onSaved?.(data)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={save} className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="text-sm font-semibold text-ink-900 mb-3">{existing?.id ? 'Edit Client' : 'New Client'}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">Code *</label><input className="field-input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="field-label">Name *</label><input className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="field-label">Contact Person</label><input className="field-input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
          <div><label className="field-label">Phone</label><input className="field-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="field-label">Email</label><input className="field-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="field-label">GST Number</label><input className="field-input" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} /></div>
          <div className="col-span-2"><label className="field-label">Address</label><textarea className="field-input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="col-span-2">
            <label className="field-label">Default Rate Category *</label>
            <select className="field-input" required value={form.default_rate_category_id} onChange={(e) => setForm({ ...form, default_rate_category_id: e.target.value })}>
              <option value="">Select…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
  )
}
