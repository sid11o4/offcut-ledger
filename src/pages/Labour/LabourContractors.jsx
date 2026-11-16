import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, EmptyState, LoadingBlock, Field, Input, Select } from '../../components/ui'
import { listContractors } from '../../lib/labourData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Every contractor and mason, with what has been paid to them. Open one for their full dashboard.
export default function LabourContractors() {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['labour_contractors'], queryFn: listContractors })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'Contractor', phone: '', notes: '' })
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('create_labour_contractor', {
      p_name: form.name, p_role: form.role, p_phone: form.phone, p_notes: form.notes,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Contractor added.')
    setAdding(false)
    setForm({ name: '', role: 'Contractor', phone: '', notes: '' })
    qc.invalidateQueries({ queryKey: ['labour_contractors'] })
  }

  return (
    <div>
      <PageHeader
        title="Labour contractors and masons"
        subtitle="Every contractor and mason, the shifts worked and what has been paid. Open one for projects, payments and history."
        actions={<button className="btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add contractor'}</button>}
      />

      {adding && (
        <Card title="New contractor or mason" className="mb-5">
          <form onSubmit={save} className="grid gap-3 md:grid-cols-4">
            <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option>Contractor</option>
                <option>Mason</option>
              </Select>
            </Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="md:col-span-4"><button className="btn-primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save contractor'}</button></div>
          </form>
        </Card>
      )}

      <Card>
        {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load contractors" hint={q.error.message} /> : !q.data.length ? (
          <EmptyState title="No contractors or masons yet" hint="Add one, then record their shifts from the Daily Log expense form." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th className="num">Shifts</th><th className="num">Total paid</th><th>Last shift</th></tr></thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'text-ink-400'}>
                    <td className="font-medium"><Link className="hover:underline" to={`/labour/${c.id}`}>{c.name}</Link></td>
                    <td>{c.role}</td>
                    <td>{c.phone || '—'}</td>
                    <td className="num">{qty(c.shifts)}</td>
                    <td className="num">{money(c.amount)}</td>
                    <td>{c.last ? displayDate(c.last) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
