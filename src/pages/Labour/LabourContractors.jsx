import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, EmptyState, LoadingBlock, Field, Input } from '../../components/ui'
import { listContractors } from '../../lib/labourData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Common trades, offered as suggestions; any trade can be typed.
export const TRADES = ['Carpenter', 'Painter', 'Mason', 'Electrician', 'Plumber', 'Tile worker', 'Polisher', 'Welder', 'Helper', 'General']

function ContractorForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '', trade: initial?.trade || 'Carpenter',
    rate: initial?.default_rate ?? '', phone: initial?.phone || '', notes: initial?.notes || '',
  })
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form) }}
      className="grid gap-3 md:grid-cols-5"
    >
      <Field label="Name"><Input required disabled={!!initial} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Trade">
        <Input list="labour-trades" required value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
        <datalist id="labour-trades">{TRADES.map((t) => <option key={t} value={t} />)}</datalist>
      </Field>
      <Field label="Rate per shift (₹)"><Input type="number" min="0" step="0.01" required value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <div className="md:col-span-5 flex gap-2">
        <button className="btn-primary" disabled={saving} type="submit">{saving ? 'Saving…' : initial ? 'Save changes' : 'Save contractor'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

// Every contractor and mason with their trade, rate per shift and what has been paid. The rate is
// set here and used for every entry; open a contractor for projects, payments and history.
export default function LabourContractors() {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['labour_contractors'], queryFn: listContractors })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  async function create(form) {
    setSaving(true)
    const { error } = await supabase.rpc('create_labour_contractor', {
      p_name: form.name, p_trade: form.trade, p_rate: Number(form.rate), p_phone: form.phone, p_notes: form.notes,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Contractor added.')
    setAdding(false)
    qc.invalidateQueries({ queryKey: ['labour_contractors'] })
    qc.invalidateQueries({ queryKey: ['labour_contractors_active'] })
  }

  async function update(contractor, form) {
    setSaving(true)
    const { error } = await supabase.rpc('update_labour_contractor', {
      p_id: contractor.id, p_trade: form.trade, p_rate: Number(form.rate), p_phone: form.phone, p_notes: form.notes, p_active: contractor.active,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Contractor updated.')
    setEditing(null)
    qc.invalidateQueries({ queryKey: ['labour_contractors'] })
    qc.invalidateQueries({ queryKey: ['labour_contractors_active'] })
    qc.invalidateQueries({ queryKey: ['labour_contractor'] })
  }

  return (
    <div>
      <PageHeader
        title="Labour contractors and masons"
        subtitle="Every contractor and mason with their trade and rate per shift. Open one for projects, payments and history."
        actions={<button className="btn-primary" onClick={() => { setAdding((v) => !v); setEditing(null) }}>{adding ? 'Close' : '+ Add contractor'}</button>}
      />

      {adding && (
        <Card title="New contractor or mason" className="mb-5">
          <ContractorForm onSave={create} onCancel={() => setAdding(false)} saving={saving} />
        </Card>
      )}

      <Card>
        {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load contractors" hint={q.error.message} /> : !q.data.length ? (
          <EmptyState title="No contractors or masons yet" hint="Add one with its trade and rate per shift." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Name</th><th>Trade</th><th>Phone</th><th className="num">Rate per shift</th><th className="num">Shifts</th><th className="num">Total paid</th><th>Last shift</th><th /></tr></thead>
              <tbody>
                {q.data.map((c) => (
                  <Fragment key={c.id}>
                    <tr className={c.active ? '' : 'text-ink-400'}>
                      <td className="font-medium"><Link className="hover:underline" to={`/labour/${c.id}`}>{c.name}</Link></td>
                      <td>{c.trade}</td>
                      <td>{c.phone || '—'}</td>
                      <td className="num">{money(c.default_rate)}</td>
                      <td className="num">{qty(c.shifts)}</td>
                      <td className="num">{money(c.amount)}</td>
                      <td>{c.last ? displayDate(c.last) : '—'}</td>
                      <td className="text-right"><button className="btn-ghost text-xs px-2" onClick={() => { setEditing(editing === c.id ? null : c.id); setAdding(false) }}>Settings</button></td>
                    </tr>
                    {editing === c.id && (
                      <tr>
                        <td colSpan={8}>
                          <ContractorForm initial={c} onSave={(form) => update(c, form)} onCancel={() => setEditing(null)} saving={saving} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
