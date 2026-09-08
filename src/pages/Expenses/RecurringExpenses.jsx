import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { useExpenseCategories } from '../../lib/queries'
import { displayDate, today } from '../../lib/dates'
import { money } from '../../lib/format'

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly', 'custom']

export default function RecurringExpenses() {
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const categoriesQ = useExpenseCategories()
  const [editing, setEditing] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const recurringQ = useQuery({
    queryKey: ['recurring_expenses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recurring_expenses').select('*, expense_categories(name)').order('name')
      if (error) throw error
      return data
    },
  })

  function startNew() {
    setEditing({ name: '', category_id: '', amount: '', frequency: 'monthly', start_date: today(), end_date: '', due_day: 1, custom_interval_days: '', notes: '', reference_number: '', active: true })
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      name: editing.name, category_id: editing.category_id, amount: Number(editing.amount), frequency: editing.frequency,
      start_date: editing.start_date, end_date: editing.end_date || null, due_day: Number(editing.due_day) || 1,
      custom_interval_days: editing.frequency === 'custom' ? Number(editing.custom_interval_days) : null,
      notes: editing.notes || null, reference_number: editing.reference_number || null, active: editing.active !== false,
    }
    let error
    if (editing.id) {
      payload.updated_by = profile?.id
      ;({ error } = await supabase.from('recurring_expenses').update(payload).eq('id', editing.id))
    } else {
      payload.created_by = profile?.id
      ;({ error } = await supabase.from('recurring_expenses').insert(payload))
    }
    if (error) return toast.error(error.message)
    toast.success(editing.id ? 'Updated.' : 'Created.')
    setEditing(null)
    qc.invalidateQueries({ queryKey: ['recurring_expenses'] })
  }

  async function toggleActive(row) {
    const ok = await confirm(row.active ? `Deactivate "${row.name}"?` : `Reactivate "${row.name}"?`, { tone: row.active ? 'danger' : 'primary', confirmLabel: row.active ? 'Deactivate' : 'Reactivate' })
    if (!ok) return
    const { error } = await supabase.from('recurring_expenses').update({ active: !row.active, updated_by: profile?.id }).eq('id', row.id)
    if (error) toast.error(error.message)
    else { toast.success('Updated.'); qc.invalidateQueries({ queryKey: ['recurring_expenses'] }) }
  }

  async function syncNow() {
    setSyncing(true)
    const { data, error } = await supabase.rpc('sync_recurring_expenses', { p_as_of: today() })
    setSyncing(false)
    if (error) return toast.error(error.message)
    toast.success(`${data} due instance(s) generated into Expenses / Daily Log.`)
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  const rows = recurringQ.data || []

  return (
    <div>
      <PageHeader
        title="Recurring / Fixed Expenses"
        subtitle="Rent, EMI, fixed salaries and similar costs that shouldn't need re-entering every period."
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={syncing} onClick={syncNow}>{syncing ? 'Syncing…' : 'Sync due instances'}</button>
            <button className="btn-primary" onClick={startNew}>+ New Recurring Expense</button>
          </div>
        }
      />
      <p className="text-xs text-ink-500 mb-4">
        "Sync due instances" generates today's/this period's due occurrences into Expenses (and that day's Daily Log) if
        not already generated. Reports also sync automatically as of their end date. Safe to run repeatedly — it never
        creates a duplicate for the same period.
      </p>

      <Card>
        {recurringQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No recurring expenses configured" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Name</th><th>Category</th><th>Amount</th><th>Frequency</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={!r.active ? 'opacity-50' : ''}>
                    <td className="font-medium">{r.name}</td>
                    <td>{r.expense_categories?.name}</td>
                    <td>{money(r.amount)}</td>
                    <td className="capitalize">{r.frequency}</td>
                    <td>{displayDate(r.start_date)}</td>
                    <td>{r.end_date ? displayDate(r.end_date) : '—'}</td>
                    <td><Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs px-2" onClick={() => setEditing(r)}>Edit</button>
                      <button className="btn-ghost text-xs px-2" onClick={() => toggleActive(r)}>{r.active ? 'Deactivate' : 'Reactivate'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-semibold text-ink-900 mb-3">{editing.id ? 'Edit' : 'New'} Recurring Expense</div>
            <div className="space-y-3">
              <div><label className="field-label">Name *</label><input className="field-input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div>
                <label className="field-label">Category *</label>
                <select className="field-input" required value={editing.category_id} onChange={(e) => setEditing({ ...editing, category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(categoriesQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="field-label">Amount (₹) *</label><input className="field-input" type="number" min="0" step="0.01" required value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></div>
                <div>
                  <label className="field-label">Frequency *</label>
                  <select className="field-input" required value={editing.frequency} onChange={(e) => setEditing({ ...editing, frequency: e.target.value })}>
                    {FREQUENCIES.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="field-label">Start Date *</label><input className="field-input" type="date" required value={editing.start_date} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div><label className="field-label">End Date</label><input className="field-input" type="date" value={editing.end_date} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
              </div>
              {editing.frequency === 'custom' ? (
                <div><label className="field-label">Repeat every N days *</label><input className="field-input" type="number" min="1" required value={editing.custom_interval_days} onChange={(e) => setEditing({ ...editing, custom_interval_days: e.target.value })} /></div>
              ) : (
                <div>
                  <label className="field-label">Due Day <span className="text-ink-400 font-normal">({editing.frequency === 'weekly' ? '1=Mon..7=Sun' : 'day within period, clamped'})</span></label>
                  <input className="field-input" type="number" min="1" max="31" value={editing.due_day} onChange={(e) => setEditing({ ...editing, due_day: e.target.value })} />
                </div>
              )}
              <div><label className="field-label">Reference Number</label><input className="field-input" value={editing.reference_number} onChange={(e) => setEditing({ ...editing, reference_number: e.target.value })} /></div>
              <div><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
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
