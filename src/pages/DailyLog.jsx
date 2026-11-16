import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { Card, StatCard, Badge, EmptyState, LoadingBlock, PageHeader } from '../components/ui'
import ProjectFormModal from '../components/ProjectFormModal'
import TradeSelect from '../components/TradeSelect'
import { useProjects, useJobWorkServices, useJobWorkComponents, useRates, useExpenseCategories, useUnits, useInventoryItems, useDesignProjects } from '../lib/queries'
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

// What an Design Build Order job uses per sheet, read from the job's name: a double-side job uses a raw
// board and two laminates, a single-side job a raw board and one laminate, and plain cutting a core.
const LAMINATION = {
  double: { title: 'Double side · 2 skins', hint: 'Each sheet uses one raw board and two laminates. Type the board as thickness, category and type (e.g. 16MM MR PLY) and each laminate as its code (e.g. 6965SUD); stock is matched from that.' },
  single: { title: 'Single side · 1 skin', hint: 'Each sheet uses one raw board and one laminate. Type the board as thickness, category and type (e.g. 16MM MR PLY) and the laminate as its code (e.g. 6965SUD); stock is matched from that.' },
  core: { title: 'Cutting · core', hint: 'Each sheet uses one core board. Type it as thickness, category and type (e.g. 16MM MR PLY).' },
  edgeband: { title: 'Edge banding · R.m', hint: 'Each running metre uses one edgeband. Type its code (e.g. 2MM EB 6965SUD) as it is in stock; the R.m entered above is consumed from that edgeband.' },
}

function laminationFor(serviceName) {
  if (/double side/i.test(serviceName)) return 'double'
  if (/single side/i.test(serviceName)) return 'single'
  if (/cutting/i.test(serviceName)) return 'core'
  // Edge banding consumes running metres of one edgeband; pasting a board and a laminate, like a single-side job.
  if (/edge/i.test(serviceName)) return 'edgeband'
  if (/past/i.test(serviceName)) return 'single'
  return null
}

const PART_LABEL = { raw: 'Raw board', skin1: 'Skin 1 laminate', skin2: 'Skin 2 laminate' }

// Lower-case letters and digits only, so spacing, punctuation and capitals do not count.
function squash(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Similarity from 0 (nothing shared) to 1 (identical), on the pairs of characters the two share.
function similarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const pairs = (s) => {
    const m = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const pair = s.slice(i, i + 2)
      m.set(pair, (m.get(pair) || 0) + 1)
    }
    return m
  }
  const pa = pairs(a)
  const pb = pairs(b)
  let shared = 0
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) || 0)
  return (2 * shared) / ((a.length - 1) + (b.length - 1))
}

// The thickness figures in a name, so a 16 mm board never matches an 18 mm one.
function thicknessOf(text) {
  return (String(text ?? '').toLowerCase().match(/\d+/g) || []).join(' ')
}

// How well a stock name matches what was typed, from 0 to 1. A raw board is compared with and
// without the Century brand, which is assumed when none is typed. A laminate matches on its code.
function scoreMaterial(kind, typed, stockName) {
  const t = squash(typed)
  const s = squash(stockName)
  if (!t || !s) return 0
  if (kind === 'laminate') {
    if (s === t) return 1
    // The code as a run of whole words in the stock name ("6965 SUD" for 6965SUD) is a clear match;
    // the code inside a longer code ("6965SUDS") is only a candidate.
    const words = String(stockName).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    for (let i = 0; i < words.length; i++) {
      let run = ''
      for (let j = i; j < words.length && run.length < t.length; j++) {
        run += words[j]
        if (run === t) return 0.97
      }
    }
    return s.includes(t) ? 0.85 : similarity(t, s)
  }
  if (thicknessOf(typed) && thicknessOf(typed) !== thicknessOf(stockName)) return 0
  return Math.max(similarity(t, s), similarity(squash(`century ${typed}`), s))
}

// What a typed material refers to. A clear single match is used as it is. Anything less certain is
// a doubt, with the closest candidates, for the user to decide before the entry is saved. Nothing
// close at all is a new item.
function matchFor(kind, typed, items) {
  const text = String(typed ?? '').trim()
  const name = kind === 'raw' ? rawBoardName(text) : text.toUpperCase()
  const ranked = items
    .map((i) => ({ item: i, score: scoreMaterial(kind, text, i.name) }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  const top = ranked[0]
  if (top && top.score >= 0.92 && !(ranked[1] && ranked[1].score >= 0.92)) {
    return { status: 'match', id: top.item.id, name: top.item.name }
  }
  if (!ranked.length) return { status: 'new', name, typed: text }
  return { status: 'doubt', name, typed: text, candidates: ranked.map((r) => ({ id: r.item.id, name: r.item.name })) }
}

// The board and laminate(s) of a lamination job, each matched to stock.
function matchLamination(lamKind, laminate, items) {
  if (lamKind === 'edgeband') return { raw: matchFor('laminate', laminate.raw, items), skin1: null, skin2: null }
  return {
    raw: matchFor('raw', laminate.raw, items),
    skin1: lamKind !== 'core' ? matchFor('laminate', laminate.skin1, items) : null,
    skin2: lamKind === 'double' ? matchFor('laminate', laminate.skin2, items) : null,
  }
}

// What each part will use: a matched item, a new item to create, or -- for a doubt the user has not
// answered -- the closest candidate, which they can change before saving.
function defaultPicks(matches) {
  const picks = {}
  for (const [key, m] of Object.entries(matches)) {
    if (!m) continue
    if (m.status === 'match') picks[key] = { id: m.id }
    else if (m.status === 'new') picks[key] = { create: m.name }
    else picks[key] = { id: m.candidates[0].id }
  }
  return picks
}

function hasDoubt(matches) {
  return Object.values(matches).some((m) => m && m.status === 'doubt')
}

// The lamination fields for the entry, creating any new item first. Each sheet uses one of each.
async function laminationArgs(picks, quantity, unitCode = 'SHEET') {
  const sheets = Number(quantity)
  const idOf = async (pick) => {
    if (!pick) return null
    if (pick.id) return pick.id
    const { data, error } = await supabase.rpc('ensure_inventory_item', { p_name: pick.create, p_unit_code: unitCode })
    if (error) throw error
    return data
  }
  const [raw, skin1, skin2] = await Promise.all([idOf(picks.raw), idOf(picks.skin1), idOf(picks.skin2)])
  return {
    p_raw_material_item_id: raw, p_raw_material_qty: sheets,
    p_skin1_item_id: skin1, p_skin1_qty: skin1 ? sheets : null,
    p_skin2_item_id: skin2, p_skin2_qty: skin2 ? sheets : null,
  }
}

// A raw board typed without a brand is Century; one that starts with a brand name is kept as typed.
function rawBoardName(typed) {
  const clean = String(typed).trim().replace(/\s+/g, ' ')
  return /^\d/.test(clean) ? `Century ${clean.toUpperCase()}` : clean
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
  // Design Build Order lamination: the board and laminate codes for the job. How many of each is the
  // sheet quantity entered above, and which fields show is set by the job's name.
  const [laminate, setLaminate] = useState({ raw: '', skin1: '', skin2: '' })
  // Set while a material is not a clear match to stock: the entry waits here until the user picks.
  const [doubt, setDoubt] = useState(null)
  const confirm = useConfirm()
  const inventoryItemsQ = useInventoryItems()

  const project = projects.find((p) => p.id === projectId)
  const service = services.find((s) => s.id === serviceId)
  // Design Build Order (spec): billing for this rate category captures Raw Material/Skin1/Skin2,
  // and that quantity is added to the linked Design Build project's consumption automatically.
  const isInternalOrder = project?.rate_categories?.code === 'INTERNAL'
  const lamKind = isInternalOrder && service ? laminationFor(service.name) : null

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

  // Saves the entry with the given rate overrides and material picks (null when not a lamination job).
  async function saveEntry(overrides, picks) {
    setSaving(true)
    let lamination = {}
    if (picks) {
      try {
        lamination = await laminationArgs(picks, quantity, lamKind === 'edgeband' ? 'RM' : 'SHEET')
      } catch (err) {
        setSaving(false)
        toast.error(err.message || 'Could not record the laminate.')
        return
      }
    }
    const { error } = await supabase.rpc('record_job_work_entry', {
      p_entry_date: date, p_project_id: projectId, p_service_id: serviceId,
      p_base_quantity: Number(quantity), p_remarks: remarks || null, p_rate_overrides: overrides,
      p_unit_id: effectiveUnitId || null,
      ...lamination,
    })
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Job work logged.')
    setDoubt(null)
    setServiceId(''); setUnitId(''); setQuantity(''); setRemarks(''); setOverrideOn(false); setOverrides({})
    setLaminate({ raw: '', skin1: '', skin2: '' })
    onSaved()
  }

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

    // Lamination: the sheet count and the parts must be there, and every typed material is matched to
    // stock. A match that is not clear is put to the user, and nothing is saved until they answer.
    if (lamKind) {
      if (!(Number(quantity) > 0)) { toast.error(lamKind === 'edgeband' ? 'Enter the running metres.' : 'Enter the quantity in sheets.'); return }
      if (!laminate.raw.trim()) { toast.error(lamKind === 'edgeband' ? 'Enter the edgeband code.' : lamKind === 'core' ? 'Enter the core board.' : 'Enter the raw board.'); return }
      if (lamKind !== 'core' && lamKind !== 'edgeband' && !laminate.skin1.trim()) { toast.error('Enter the skin 1 laminate code.'); return }
      if (lamKind === 'double' && !laminate.skin2.trim()) { toast.error('Enter the skin 2 laminate code.'); return }
    }
    const matches = lamKind ? matchLamination(lamKind, laminate, inventoryItemsQ.data || []) : null
    if (matches && hasDoubt(matches)) {
      setDoubt({ overrides: payloadOverrides, matches, picks: defaultPicks(matches) })
      return
    }
    await saveEntry(payloadOverrides, matches ? defaultPicks(matches) : null)
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

        {lamKind && (
          <div className="space-y-3 rounded-lg border border-ink-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
                <Badge tone="brand">Design Build Order</Badge> {LAMINATION[lamKind].title}
              </div>
              <span className="tnum text-xs text-ink-500">{quantity || 0} {lamKind === 'edgeband' ? 'R.m' : 'sheets'}</span>
            </div>

            <div className={`grid gap-3 ${lamKind === 'double' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <div>
                <label className="field-label">{lamKind === 'edgeband' ? 'Edgeband code' : lamKind === 'core' ? 'Core board' : 'Raw board'}</label>
                <input
                  className="field-input" list="inventory-materials"
                  placeholder={lamKind === 'edgeband' ? 'e.g. 2MM EB 6965SUD' : lamKind === 'core' ? 'e.g. 16MM CORE' : 'e.g. 16MM MR PLY'}
                  value={laminate.raw} onChange={(e) => setLaminate({ ...laminate, raw: e.target.value })}
                />
              </div>
              {lamKind !== 'core' && lamKind !== 'edgeband' && (
                <div>
                  <label className="field-label">Skin 1 laminate code</label>
                  <input
                    className="field-input" list="inventory-materials" placeholder="Laminate code"
                    value={laminate.skin1} onChange={(e) => setLaminate({ ...laminate, skin1: e.target.value })}
                  />
                </div>
              )}
              {lamKind === 'double' && (
                <div>
                  <label className="field-label">Skin 2 laminate code</label>
                  <input
                    className="field-input" list="inventory-materials" placeholder="Laminate code"
                    value={laminate.skin2} onChange={(e) => setLaminate({ ...laminate, skin2: e.target.value })}
                  />
                </div>
              )}
            </div>

            <p className="text-xs text-ink-500">
              {LAMINATION[lamKind].hint} A material that is not in inventory yet is added automatically and shows as negative stock until it is bought.
            </p>
            <datalist id="inventory-materials">
              {(inventoryItemsQ.data || []).map((i) => <option key={i.id} value={i.name} />)}
            </datalist>
          </div>
        )}

        {doubt && (
          <div role="alertdialog" aria-label="Check materials" className="space-y-4 rounded-lg border border-ink-300 bg-white p-4">
            <div>
              <div className="text-sm font-medium text-ink-950">Check these materials before saving</div>
              <p className="mt-1 text-xs text-ink-500">They are not an exact match to stock. Pick what each one means, or add it as a new item.</p>
            </div>
            {Object.entries(doubt.matches).filter(([, m]) => m && m.status === 'doubt').map(([key, m]) => (
              <fieldset key={key} className="space-y-1.5">
                <legend className="field-label">{PART_LABEL[key]}: “{m.typed}”</legend>
                {m.candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink-900">
                    <input
                      type="radio" name={`pick-${key}`} checked={doubt.picks[key].id === c.id}
                      onChange={() => setDoubt({ ...doubt, picks: { ...doubt.picks, [key]: { id: c.id } } })}
                    />
                    {c.name}
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                  <input
                    type="radio" name={`pick-${key}`} checked={doubt.picks[key].create !== undefined}
                    onChange={() => setDoubt({ ...doubt, picks: { ...doubt.picks, [key]: { create: m.name } } })}
                  />
                  Add as new: {m.name}
                </label>
              </fieldset>
            ))}
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={saving} onClick={() => saveEntry(doubt.overrides, doubt.picks)}>
                Confirm and add entry
              </button>
              <button type="button" className="btn-secondary" onClick={() => setDoubt(null)}>Back</button>
            </div>
          </div>
        )}

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

let labourRowSeq = 0
function newLabourRow() {
  labourRowSeq += 1
  return { key: `row-${labourRowSeq}`, charge: '', shifts: '', recovery: '' }
}

// A bonus, advance or other payment to the contractor: an amount with remarks, not shifts.
function newPaymentRow() {
  labourRowSeq += 1
  return { key: `pay-${labourRowSeq}`, charge: '', kind: 'bonus', amount: '', remarks: '' }
}

// Where a labour row or an ordinary expense is charged, as one choice: "db:" is the Design Build
// company, "db:<id>" a Design Build project, "f:" Factory-wide, "f:<id>" a factory project.
function chargeOf(value) {
  const [code, id] = String(value || '').split(':')
  if (!code || !(code === 'db' || code === 'f')) return null
  return code === 'db'
    ? { side: 'design_build', project_id: null, design_project_id: id || null }
    : { side: 'factory', project_id: id || null, design_project_id: null }
}

function ExpenseEntryForm({ date, categories, projects, profile, toast, onSaved }) {
  const qc = useQueryClient()
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  // Ordinary expenses: Design Build or Factory, then the company-wide option or one project.
  const [side, setSide] = useState('factory')
  const [target, setTarget] = useState('')
  // Labour: one contractor for the whole entry, at their rate per shift; then a row per project.
  const [contractorId, setContractorId] = useState('')
  const [rows, setRows] = useState([newLabourRow()])
  const [payments, setPayments] = useState([newPaymentRow()])
  const [newContractor, setNewContractor] = useState({ name: '', trade: 'General', rate: '' })
  const [saving, setSaving] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const designProjectsQ = useDesignProjects()
  const allDesignProjects = designProjectsQ.data || []
  const contractorsQ = useQuery({
    queryKey: ['labour_contractors_active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_contractors').select('id, name, trade, default_rate').eq('active', true).order('name')
      if (error) throw error
      return data || []
    },
  })
  const contractor = (contractorsQ.data || []).find((c) => c.id === contractorId)
  const rate = Number(contractor?.default_rate || 0)
  const isLabour = categories.find((c) => c.id === categoryId)?.name === 'Labour'
  // A shift row's total is its pay less any advance it repays.
  const rowTotal = (r) => Math.round((Number(r.shifts || 0) * rate - Number(r.recovery || 0)) * 100) / 100
  const labourTotal = rows.reduce((t, r) => t + rowTotal(r), 0)
  const paymentTotal = payments.reduce((t, r) => t + (Math.round(Number(r.amount || 0) * 100) / 100), 0)
  // Factory projects that are not Design Build projects: Design Build projects are listed on their own side.
  const designLinkedFactoryIds = new Set(allDesignProjects.map((d) => d.factory_project_id).filter(Boolean))
  const nonDesignFactoryProjects = projects.filter((p) => !designLinkedFactoryIds.has(p.id))

  function chooseSide(next) {
    setSide(next)
    setTarget('')
  }

  function updateRow(key, patch) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs))
  }

  function updatePayment(key, patch) {
    setPayments((ps) => ps.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removePayment(key) {
    setPayments((ps) => (ps.length > 1 ? ps.filter((r) => r.key !== key) : ps))
  }

  // A new contractor or mason, with their trade and rate per shift, becomes the contractor for this entry.
  async function addContractor() {
    if (!newContractor.name.trim()) return toast.error('Enter the name.')
    if (!(Number(newContractor.rate) >= 0) || newContractor.rate === '') return toast.error('Enter the rate per shift.')
    const { data, error } = await supabase.rpc('create_labour_contractor', {
      p_name: newContractor.name, p_trade: newContractor.trade, p_rate: Number(newContractor.rate), p_phone: null, p_notes: null,
    })
    if (error) return toast.error(error.message)
    setContractorId(data.id)
    setNewContractor({ name: '', trade: 'General', rate: '' })
    qc.invalidateQueries({ queryKey: ['labour_contractors_active'] })
    qc.invalidateQueries({ queryKey: ['labour_contractors'] })
    qc.invalidateQueries({ queryKey: ['labour_trades'] })
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    let error
    let message
    if (isLabour) {
      if (!contractorId) { setSaving(false); return toast.error('Choose the contractor or mason.') }
      const payload = []
      for (const r of rows) {
        if (String(r.shifts).trim() === '' && !r.charge) continue
        const c = chargeOf(r.charge)
        if (!c) { setSaving(false); return toast.error('Choose where every shift row is charged.') }
        if (!(Number(r.shifts) > 0)) { setSaving(false); return toast.error('Enter the shifts for every shift row.') }
        payload.push({ kind: 'shift', contractor_id: contractorId, side: c.side, project_id: c.project_id, design_project_id: c.design_project_id, shifts: Number(r.shifts), rate, recovery: Number(r.recovery || 0), notes: description || null })
      }
      for (const r of payments) {
        if (String(r.amount).trim() === '' && !r.charge) continue
        const c = chargeOf(r.charge)
        if (!c) { setSaving(false); return toast.error('Choose where every payment is charged.') }
        if (!(Number(r.amount) > 0)) { setSaving(false); return toast.error('Enter the amount for every payment.') }
        payload.push({ kind: r.kind, contractor_id: contractorId, side: c.side, project_id: c.project_id, design_project_id: c.design_project_id, amount: Number(r.amount), notes: r.remarks || null })
      }
      if (!payload.length) { setSaving(false); return toast.error('Enter shifts or a payment.') }
      ;({ error } = await supabase.rpc('record_labour_entries', { p_entry_date: date, p_notes: description || null, p_rows: payload }))
      message = `Labour logged for ${contractor.name}: ${money(labourTotal + paymentTotal)}.`
    } else {
      const common = { expense_date: date, category_id: categoryId, amount: Number(amount), description: description || null }
      ;({ error } = side === 'factory'
        ? await supabase.from('expenses').insert({ ...common, project_id: target || null, created_by: profile?.id })
        : await supabase.from('design_build_expenses').insert({ ...common, design_project_id: target || null, created_by: profile?.id }))
      message = side === 'factory' ? 'Factory expense logged.' : 'Design Build expense logged.'
    }
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(message)
    setCategoryId(''); setAmount(''); setDescription(''); setTarget('')
    setRows([newLabourRow()])
    setPayments([newPaymentRow()])
    onSaved()
  }

  const chargeOptions = (
    <>
      <option value="db:">Design Build · company</option>
      {allDesignProjects.map((p) => <option key={p.id} value={`db:${p.id}`}>Design Build · {p.name}</option>)}
      <option value="f:">Factory · Factory wide</option>
      {nonDesignFactoryProjects.map((p) => <option key={p.id} value={`f:${p.id}`}>Factory · {p.name}</option>)}
    </>
  )

  return (
    <Card title="Add Expense">
      {showNewProject && (
        <ProjectFormModal
          existing={null}
          onClose={() => setShowNewProject(false)}
          onSaved={(p) => { setShowNewProject(false); setSide('factory'); setTarget(p.id) }}
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
          {!isLabour && (
            <div>
              <label className="field-label">Amount (₹) *</label>
              <input className="field-input" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
        </div>

        {isLabour && (
          <div className="space-y-3 rounded-lg border border-ink-200 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="field-label">Contractor / mason *</label>
                <select className="field-input" required value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                  <option value="">Select…</option>
                  {(contractorsQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.trade}</option>)}
                </select>
                {contractor && (
                  <div className="mt-1 text-xs text-ink-500">{contractor.trade} · {money(rate)} per shift (change it in Labour contractors → Settings)</div>
                )}
              </div>
              <div>
                <label className="field-label">Or add a new contractor</label>
                <div className="grid grid-cols-3 gap-1">
                  <input className="field-input text-xs" placeholder="Name" value={newContractor.name} onChange={(e) => setNewContractor({ ...newContractor, name: e.target.value })} />
                  <TradeSelect value={newContractor.trade} onChange={(trade) => setNewContractor({ ...newContractor, trade })} />
                  <input className="field-input text-xs" type="number" min="0" step="0.01" placeholder="Rate / shift" value={newContractor.rate} onChange={(e) => setNewContractor({ ...newContractor, rate: e.target.value })} />
                </div>
                <button type="button" className="btn-ghost text-xs px-2 mt-1" onClick={addContractor}>Add contractor</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Charged to</th><th className="num">Shifts</th><th className="num">Advance repaid (₹)</th><th className="num">Total (₹)</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <select className="field-input" value={r.charge} onChange={(e) => updateRow(r.key, { charge: e.target.value })}>
                          <option value="">Select project…</option>
                          {chargeOptions}
                        </select>
                      </td>
                      <td className="num"><input className="field-input w-24 text-right" type="number" min="0.01" step="0.01" value={r.shifts} onChange={(e) => updateRow(r.key, { shifts: e.target.value })} /></td>
                      <td className="num"><input className="field-input w-28 text-right" type="number" min="0" step="0.01" placeholder="0" value={r.recovery} onChange={(e) => updateRow(r.key, { recovery: e.target.value })} /></td>
                      <td className="num tnum">{money(rowTotal(r))}</td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost text-xs px-2" disabled={rows.length === 1} onClick={() => removeRow(r.key)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td className="font-medium">Total for the day</td><td /><td /><td className="num tnum font-medium">{money(labourTotal)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => setRows((rs) => [...rs, newLabourRow()])}>+ Add row</button>

            <div className="border-t border-ink-200 pt-3">
              <div className="mb-2 text-xs font-medium text-ink-700">Bonus, advance and other payments</div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th>Charged to</th><th>Type</th><th className="num">Amount (₹)</th><th>Remarks</th><th /></tr>
                  </thead>
                  <tbody>
                    {payments.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <select className="field-input" value={r.charge} onChange={(e) => updatePayment(r.key, { charge: e.target.value })}>
                            <option value="">Select project…</option>
                            {chargeOptions}
                          </select>
                        </td>
                        <td>
                          <select className="field-input" value={r.kind} onChange={(e) => updatePayment(r.key, { kind: e.target.value })}>
                            <option value="bonus">Bonus (not repaid)</option>
                            <option value="advance">Advance (to be repaid from shift pay)</option>
                            <option value="other">Other payment</option>
                          </select>
                        </td>
                        <td className="num"><input className="field-input w-28 text-right" type="number" min="0" step="0.01" value={r.amount} onChange={(e) => updatePayment(r.key, { amount: e.target.value })} /></td>
                        <td><input className="field-input" placeholder="Reason or remarks" value={r.remarks} onChange={(e) => updatePayment(r.key, { remarks: e.target.value })} /></td>
                        <td className="text-right">
                          <button type="button" className="btn-ghost text-xs px-2" disabled={payments.length === 1} onClick={() => removePayment(r.key)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={2} className="font-medium">Payments total</td><td className="num tnum font-medium">{money(paymentTotal)}</td><td colSpan={2} /></tr>
                  </tfoot>
                </table>
              </div>
              <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => setPayments((ps) => [...ps, newPaymentRow()])}>+ Add payment</button>
            </div>
          </div>
        )}

        <div>
          <label className="field-label">Description{isLabour ? ' (applies to every row)' : ''}</label>
          <input className="field-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {!isLabour && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Charge to *</label>
              <select className="field-input" value={side} onChange={(e) => chooseSide(e.target.value)}>
                <option value="design_build">Design Build</option>
                <option value="factory">Factory</option>
              </select>
            </div>
            {side === 'design_build' ? (
              <div>
                <label className="field-label">Design Build</label>
                <select className="field-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Design Build company</option>
                  {allDesignProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <label className="field-label mb-0">Factory</label>
                  <button type="button" className="btn-ghost text-xs px-2 text-brand-700" onClick={() => setShowNewProject(true)}>+ New</button>
                </div>
                <select className="field-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Factory wide</option>
                  {nonDesignFactoryProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : isLabour ? 'Save labour' : 'Add Expense'}</button>
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
