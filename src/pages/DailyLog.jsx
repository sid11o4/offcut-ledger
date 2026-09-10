import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { Card, StatCard, Badge, EmptyState, LoadingBlock, PageHeader } from '../components/ui'
import ProjectFormModal from '../components/ProjectFormModal'
import { useProjects, useJobWorkServices, useJobWorkComponents, useRates, useExpenseCategories, useUnits } from '../lib/queries'
import { previewEntry, availableUnitsForService } from '../lib/calc'
import { today, displayDate } from '../lib/dates'
import { money, qty } from '../lib/format'

export default function DailyLog() {
  // Supports deep-linking from Global Search ("...appeared in that day's Daily Log" -- spec
  // section 27/50) via /daily-log?date=YYYY-MM-DD; falls back to today when absent/invalid.
  const [searchParams] = useSearchParams()
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '') ? searchParams.get('date') : today()
  const [date, setDate] = useState(initialDate)
  const { profile, hasPermission } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const projectsQ = useProjects()
  const servicesQ = useJobWorkServices()
  const componentsQ = useJobWorkComponents()
  const ratesQ = useRates()
  const unitsQ = useUnits()
  const expenseCategoriesQ = useExpenseCategories()

  const entriesQ = useQuery({
    queryKey: ['daily-entries', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('*, projects(name,code), job_work_services(name), job_work_entry_components(*, job_work_services(name), machines(name))')
        .eq('entry_date', date)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  const expensesQ = useQuery({
    queryKey: ['daily-expenses', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, expense_categories(name), projects(name)')
        .eq('expense_date', date)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  const activeProjects = (projectsQ.data || []).filter((p) => ['draft', 'active', 'on_hold'].includes(p.status))
  const activeServices = (servicesQ.data || []).filter((s) => s.active)

  const activeEntries = (entriesQ.data || []).filter((e) => e.status === 'active')
  const summary = useMemo(() => {
    const byProject = new Map(), byService = new Map(), byMachine = new Map()
    let total = 0
    for (const e of activeEntries) {
      total += Number(e.total_amount)
      byProject.set(e.projects?.name, (byProject.get(e.projects?.name) || 0) + Number(e.total_amount))
      byService.set(e.job_work_services?.name, (byService.get(e.job_work_services?.name) || 0) + Number(e.total_amount))
      for (const c of e.job_work_entry_components || []) {
        const name = c.machines?.name
        if (name) byMachine.set(name, (byMachine.get(name) || 0) + Number(c.amount))
      }
    }
    return { byProject, byService, byMachine, total, count: activeEntries.length }
  }, [activeEntries])

  const totalExpenses = (expensesQ.data || []).filter((x) => x.status === 'active').reduce((s, x) => s + Number(x.amount), 0)

  function shiftDate(deltaDays) {
    const d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + deltaDays)
    setDate(d.toISOString().slice(0, 10))
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['daily-entries', date] })
    qc.invalidateQueries({ queryKey: ['daily-expenses', date] })
  }

  return (
    <div>
      <PageHeader
        title="Daily Log"
        subtitle="Enter today's job work and expenses — revenue calculates automatically."
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => shiftDate(-1)}>← Prev</button>
            <input type="date" className="field-input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn-secondary" onClick={() => shiftDate(1)}>Next →</button>
            <button className="btn-ghost" onClick={() => setDate(today())}>Today</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Job Entries" value={summary.count} />
        <StatCard label="Daily Revenue" value={money(summary.total)} tone="brand" />
        <StatCard label="Daily Expenses" value={money(totalExpenses)} tone="bad" />
        <StatCard label="Net" value={money(summary.total - totalExpenses)} tone={summary.total - totalExpenses >= 0 ? 'ok' : 'bad'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <JobWorkEntryForm
            date={date}
            projects={activeProjects}
            services={activeServices}
            components={componentsQ.data || []}
            rates={ratesQ.data || []}
            units={unitsQ.data || []}
            canOverride={hasPermission('rate_override')}
            toast={toast}
            onSaved={invalidate}
          />
          <ExpenseEntryForm date={date} categories={expenseCategoriesQ.data || []} projects={activeProjects} profile={profile} toast={toast} onSaved={invalidate} />
        </div>

        <div className="space-y-5">
          <Card title={`Job Work — ${displayDate(date)}`}>
            {entriesQ.isLoading ? <LoadingBlock /> : !entriesQ.data?.length ? <EmptyState title="No job work logged for this day" /> : (
              <EntriesList entries={entriesQ.data} canCancel={hasPermission('historical_edit')} toast={toast} onChanged={invalidate} />
            )}
          </Card>

          <div className="grid grid-cols-2 gap-5">
            <Card title="Revenue by Project">
              {!summary.byProject.size ? <EmptyState title="No data" /> : (
                <ul className="space-y-1.5">
                  {[...summary.byProject.entries()].map(([name, amt]) => (
                    <li key={name} className="flex justify-between text-sm"><span>{name}</span><span className="font-medium">{money(amt)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Revenue by Job Work">
              {!summary.byService.size ? <EmptyState title="No data" /> : (
                <ul className="space-y-1.5">
                  {[...summary.byService.entries()].map(([name, amt]) => (
                    <li key={name} className="flex justify-between text-sm"><span>{name}</span><span className="font-medium">{money(amt)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Revenue by Machine">
            {!summary.byMachine.size ? <EmptyState title="No data" /> : (
              <ul className="space-y-1.5">
                {[...summary.byMachine.entries()].map(([name, amt]) => (
                  <li key={name} className="flex justify-between text-sm"><span>{name}</span><span className="font-medium">{money(amt)}</span></li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Expenses">
            {expensesQ.isLoading ? <LoadingBlock /> : !expensesQ.data?.length ? <EmptyState title="No expenses logged for this day" /> : (
              <ExpensesList expenses={expensesQ.data} canVoid={hasPermission('expense_manage')} toast={toast} onChanged={invalidate} />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function JobWorkEntryForm({ date, projects, services, components, rates, units, canOverride, toast, onSaved }) {
  const [projectId, setProjectId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [remarks, setRemarks] = useState('')
  const [overrideOn, setOverrideOn] = useState(false)
  const [overrides, setOverrides] = useState({}) // componentServiceId -> {rate, reason}
  const [saving, setSaving] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const confirm = useConfirm()

  const project = projects.find((p) => p.id === projectId)
  const service = services.find((s) => s.id === serviceId)

  // Units this service can be logged in for the project's rate category as of the log date.
  const unitOptions = useMemo(() => {
    if (!service || !project) return []
    return availableUnitsForService(service, project.rate_category_id, date, services, components, rates, units)
  }, [service, project, date, services, components, rates, units])

  // Pick a sensible default unit whenever the service (or its available units) changes.
  function chooseService(id) {
    setServiceId(id)
    const svc = services.find((s) => s.id === id)
    setUnitId(svc?.unit_id || '')
  }
  const effectiveUnitId = unitId || service?.unit_id || ''

  const preview = useMemo(() => {
    if (!service || !project || !effectiveUnitId) return { lines: [], total: 0, missingRates: [] }
    return previewEntry({
      service, baseQuantity: quantity, rateCategoryId: project.rate_category_id, unitId: effectiveUnitId, asOfDate: date,
      allServices: services, allComponents: components, allRates: rates,
    })
  }, [service, project, quantity, effectiveUnitId, date, services, components, rates])

  const unitName = units.find((u) => u.id === effectiveUnitId)?.name

  async function submit(e) {
    e.preventDefault()
    if (preview.missingRates.length && !overrideOn) {
      toast.error(`No rate configured for: ${preview.missingRates.join(', ')}. Ask an admin to add a rate, or override.`)
      return
    }
    let payloadOverrides = null
    if (overrideOn) {
      const ok = await confirm('Save this entry with an overridden rate?', {
        detail: 'The override, reason, and your name are recorded in the audit trail.',
        confirmLabel: 'Save with override',
        tone: 'primary',
      })
      if (!ok) return
      payloadOverrides = preview.lines.map((l) => {
        const o = overrides[l.service.id]
        return { component_service_id: l.service.id, rate: Number(o?.rate ?? l.rate ?? 0), reason: o?.reason || '' }
      })
      if (payloadOverrides.some((o) => !o.reason)) {
        toast.error('Please provide a reason for every overridden rate.')
        return
      }
    }

    setSaving(true)
    const { error } = await supabase.rpc('record_job_work_entry', {
      p_entry_date: date, p_project_id: projectId, p_service_id: serviceId,
      p_base_quantity: Number(quantity), p_remarks: remarks || null, p_rate_overrides: payloadOverrides,
      p_unit_id: effectiveUnitId || null,
    })
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Job work logged.')
    setServiceId(''); setUnitId(''); setQuantity(''); setRemarks(''); setOverrideOn(false); setOverrides({})
    onSaved()
  }

  return (
    <Card title="Add Job Work">
      {showNewProject && (
        <ProjectFormModal
          existing={null}
          onClose={() => setShowNewProject(false)}
          onSaved={(p) => { setShowNewProject(false); setProjectId(p.id) }}
        />
      )}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="field-label mb-0">Project *</label>
              <button type="button" className="btn-ghost text-xs px-2 text-brand-700" onClick={() => setShowNewProject(true)}>+ New</button>
            </div>
            <select className="field-input" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Job Work *</label>
            <select className="field-input" required value={serviceId} onChange={(e) => chooseService(e.target.value)}>
              <option value="">Select…</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Quantity{unitName ? ` (${unitName})` : ''} *</label>
            <input className="field-input" type="number" min="0.0001" step="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="field-label">
              Unit *{service && unitOptions.length > 1 && <span className="text-ink-400 font-normal"> — pick if not the default</span>}
            </label>
            <select
              className="field-input"
              required
              disabled={!service}
              value={effectiveUnitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              {(unitOptions.length ? unitOptions : (service ? units.filter((u) => u.id === service.unit_id) : [])).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">Remarks</label>
          <input className="field-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {preview.lines.length > 0 && (
          <div className="rounded-md bg-ink-50 border border-ink-200 p-3 text-sm">
            <div className="text-xs font-semibold text-ink-500 uppercase mb-2">Calculation</div>
            {preview.lines.map((l) => (
              <div key={l.service.id} className="flex items-center justify-between py-0.5">
                <span>{l.service.name}: {qty(l.componentQuantity)} {unitName} ×
                  {overrideOn ? (
                    <input
                      type="number" step="0.01" className="field-input inline-block w-24 mx-1 py-0.5"
                      value={overrides[l.service.id]?.rate ?? l.rate ?? ''}
                      onChange={(e) => setOverrides({ ...overrides, [l.service.id]: { ...overrides[l.service.id], rate: e.target.value } })}
                    />
                  ) : (
                    <span className="font-medium mx-1">{l.rate === null ? 'no rate' : money(l.rate)}</span>
                  )}
                </span>
                <span className="font-medium">{money(overrideOn ? (overrides[l.service.id]?.rate ?? l.rate ?? 0) * l.componentQuantity : l.amount)}</span>
              </div>
            ))}
            {overrideOn && (
              <input
                className="field-input mt-2" placeholder="Reason for override (required)"
                value={overrides._reason || ''}
                onChange={(e) => {
                  const next = { ...overrides, _reason: e.target.value }
                  for (const l of preview.lines) next[l.service.id] = { ...next[l.service.id], reason: e.target.value }
                  setOverrides(next)
                }}
              />
            )}
            <div className="flex items-center justify-between border-t border-ink-200 mt-2 pt-2 font-semibold">
              <span>Total</span>
              <span>{money(overrideOn ? preview.lines.reduce((s, l) => s + (Number(overrides[l.service.id]?.rate ?? l.rate ?? 0) * l.componentQuantity), 0) : preview.total)}</span>
            </div>
            {preview.missingRates.length > 0 && !overrideOn && (
              <div className="text-bad text-xs mt-2">No rate configured for: {preview.missingRates.join(', ')}.</div>
            )}
          </div>
        )}

        {canOverride && preview.lines.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} />
            Override the rate for this entry
          </label>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Add Entry'}</button>
      </form>
    </Card>
  )
}

function EntriesList({ entries, canCancel, toast, onChanged }) {
  const confirm = useConfirm()

  async function cancelEntry(entry) {
    const reason = window.prompt('Reason for cancelling this entry:')
    if (!reason) return
    const ok = await confirm(`Cancel this ${entry.job_work_services?.name} entry?`, { detail: 'This cannot be undone.', confirmLabel: 'Cancel entry' })
    if (!ok) return
    const { error } = await supabase.rpc('cancel_job_work_entry', { p_entry_id: entry.id, p_reason: reason })
    if (error) toast.error(error.message)
    else { toast.success('Entry cancelled.'); onChanged() }
  }

  return (
    <div className="overflow-x-auto -mx-4">
      <table className="table-base">
        <thead><tr><th>Project</th><th>Job Work</th><th>Qty</th><th>Amount</th><th>Status</th>{canCancel && <th></th>}</tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={e.status === 'cancelled' ? 'opacity-40 line-through' : ''}>
              <td>{e.projects?.name}</td>
              <td>{e.job_work_services?.name}{e.remarks && <div className="text-xs text-ink-400">{e.remarks}</div>}</td>
              <td>{qty(e.base_quantity)}</td>
              <td>{money(e.total_amount)}</td>
              <td>
                {e.status === 'cancelled' ? <Badge tone="bad">Cancelled</Badge> : e.billed ? <Badge tone="ok">Billed</Badge> : <Badge tone="warn">Unbilled</Badge>}
              </td>
              {canCancel && (
                <td>
                  {e.status === 'active' && !e.billed && (
                    <button className="btn-ghost text-xs px-2 text-bad" onClick={() => cancelEntry(e)}>Cancel</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExpenseEntryForm({ date, categories, projects, profile, toast, onSaved }) {
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('expenses').insert({
      expense_date: date, category_id: categoryId, amount: Number(amount),
      description: description || null, project_id: projectId || null, created_by: profile?.id,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Expense logged.')
    setCategoryId(''); setAmount(''); setDescription(''); setProjectId('')
    onSaved()
  }

  return (
    <Card title="Add Expense">
      {showNewProject && (
        <ProjectFormModal
          existing={null}
          onClose={() => setShowNewProject(false)}
          onSaved={(p) => { setShowNewProject(false); setProjectId(p.id) }}
        />
      )}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Category *</label>
            <select className="field-input" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Select…</option>
              {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Amount (₹) *</label>
            <input className="field-input" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="field-label">Description</label>
          <input className="field-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="field-label mb-0">Project <span className="text-ink-400 font-normal">(optional — leave blank for factory-wide)</span></label>
            <button type="button" className="btn-ghost text-xs px-2 text-brand-700" onClick={() => setShowNewProject(true)}>+ New</button>
          </div>
          <select className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Factory-wide</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Add Expense'}</button>
      </form>
    </Card>
  )
}

function ExpensesList({ expenses, canVoid, toast, onChanged }) {
  const confirm = useConfirm()

  async function voidExpense(exp) {
    const reason = window.prompt('Reason for voiding this expense:')
    if (!reason) return
    const ok = await confirm('Void this expense?', { detail: 'This cannot be undone.', confirmLabel: 'Void' })
    if (!ok) return
    const { error } = await supabase.rpc('void_expense', { p_expense_id: exp.id, p_reason: reason })
    if (error) toast.error(error.message)
    else { toast.success('Expense voided.'); onChanged() }
  }

  return (
    <ul className="divide-y divide-ink-100">
      {expenses.map((x) => (
        <li key={x.id} className={`py-2 flex items-center justify-between text-sm ${x.status === 'void' ? 'opacity-40 line-through' : ''}`}>
          <div>
            <div className="font-medium">{x.expense_categories?.name}{x.source === 'recurring' && <Badge tone="brand">recurring</Badge>}</div>
            <div className="text-xs text-ink-400">{x.description || x.projects?.name || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{money(x.amount)}</span>
            {canVoid && x.status === 'active' && <button className="btn-ghost text-xs px-2 text-bad" onClick={() => voidExpense(x)}>Void</button>}
          </div>
        </li>
      ))}
    </ul>
  )
}
