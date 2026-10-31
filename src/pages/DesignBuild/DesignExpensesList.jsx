import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { useExpenseCategories, useDesignProjects } from '../../lib/queries'
import { displayDate, today } from '../../lib/dates'
import { money } from '../../lib/format'

// Design Build's own expenses, the Design Build counterpart of Factory's Expenses page. Recurring
// rows come from Design Build recurring expenses; manual rows are entered here or in the Daily Log.
export default function DesignExpensesList() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [adding, setAdding] = useState(null)
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile, hasPermission } = useAuth()

  const categoriesQ = useExpenseCategories()
  const designProjectsQ = useDesignProjects()

  const expensesQ = useQuery({
    queryKey: ['design_expenses', start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_build_expenses')
        .select('*, expense_categories(name), design_projects(name)')
        .gte('expense_date', start).lte('expense_date', end)
        .order('expense_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const rows = (expensesQ.data || []).filter((x) => !categoryFilter || x.category_id === categoryFilter)
  const activeTotal = rows.filter((x) => x.status === 'active').reduce((s, x) => s + Number(x.amount), 0)
  const manualTotal = rows.filter((x) => x.status === 'active' && x.source === 'manual').reduce((s, x) => s + Number(x.amount), 0)
  const recurringTotal = rows.filter((x) => x.status === 'active' && x.source === 'recurring').reduce((s, x) => s + Number(x.amount), 0)

  function startAdd() {
    setAdding({ expense_date: today(), category_id: '', amount: '', description: '', design_project_id: '', payment_reference: '', notes: '' })
  }

  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('design_build_expenses').insert({
      expense_date: adding.expense_date, category_id: adding.category_id, amount: Number(adding.amount),
      description: adding.description || null, design_project_id: adding.design_project_id || null,
      payment_reference: adding.payment_reference || null, notes: adding.notes || null, created_by: profile?.id,
    })
    if (error) return toast.error(error.message)
    toast.success('Design Build expense recorded.')
    setAdding(null)
    qc.invalidateQueries({ queryKey: ['design_expenses'] })
    qc.invalidateQueries({ queryKey: ['db_statement'] })
    qc.invalidateQueries({ queryKey: ['db_ledger'] })
  }

  async function voidExpense(exp) {
    const reason = window.prompt('Reason for voiding this expense:')
    if (!reason) return
    const ok = await confirm('Void this expense?', { confirmLabel: 'Void' })
    if (!ok) return
    const { error } = await supabase.from('design_build_expenses')
      .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: profile?.id, void_reason: reason })
      .eq('id', exp.id)
    if (error) toast.error(error.message)
    else {
      toast.success('Voided.')
      qc.invalidateQueries({ queryKey: ['design_expenses'] })
      qc.invalidateQueries({ queryKey: ['db_statement'] })
      qc.invalidateQueries({ queryKey: ['db_ledger'] })
    }
  }

  return (
    <div>
      <PageHeader
        title="Design Build Expenses"
        subtitle="Expenses charged to the Design Build company or one of its projects. Factory expenses are not shown here."
        actions={<button className="btn-primary" onClick={startAdd}>+ Add Expense</button>}
      />

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Total" value={money(activeTotal)} tone="bad" />
        <StatCard label="Manual" value={money(manualTotal)} />
        <StatCard label="Recurring" value={money(recurringTotal)} tone="brand" />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <select className="field-input w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {(categoriesQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <Card>
        {expensesQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No Design Build expenses in this period" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Charged to</th><th>Source</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={x.status === 'voided' ? 'opacity-40 line-through' : ''}>
                    <td>{displayDate(x.expense_date)}</td>
                    <td>{x.expense_categories?.name}</td>
                    <td>{x.description || '—'}</td>
                    <td>{x.design_projects?.name || <span className="text-ink-400">Company</span>}</td>
                    <td>{x.source === 'recurring' ? <Badge tone="brand">Recurring</Badge> : <Badge tone="neutral">Manual</Badge>}</td>
                    <td className="font-medium">{money(x.amount)}</td>
                    <td>
                      {hasPermission('design_build_manage') && x.status === 'active' && (
                        <button className="btn-ghost text-xs px-2 text-bad" onClick={() => voidExpense(x)}>Void</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-md">
            <div className="text-sm font-semibold text-ink-900 mb-3">Add Design Build Expense</div>
            <div className="space-y-3">
              <div><label className="field-label">Date *</label><input className="field-input" type="date" required value={adding.expense_date} onChange={(e) => setAdding({ ...adding, expense_date: e.target.value })} /></div>
              <div>
                <label className="field-label">Charge to</label>
                <select className="field-input" value={adding.design_project_id} onChange={(e) => setAdding({ ...adding, design_project_id: e.target.value })}>
                  <option value="">Design Build company</option>
                  {(designProjectsQ.data || []).filter((p) => p.status !== 'completed').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Category *</label>
                <select className="field-input" required value={adding.category_id} onChange={(e) => setAdding({ ...adding, category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(categoriesQ.data || []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="field-label">Amount (₹) *</label><input className="field-input" type="number" min="0" step="0.01" required value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} /></div>
              <div><label className="field-label">Description</label><input className="field-input" value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} /></div>
              <div><label className="field-label">Payment Reference</label><input className="field-input" value={adding.payment_reference} onChange={(e) => setAdding({ ...adding, payment_reference: e.target.value })} /></div>
              <div><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
