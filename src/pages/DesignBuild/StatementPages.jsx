import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import BankStatement from '../../components/BankStatement'
import { useDesignProjects } from '../../lib/queries'
import { listSuppliers, loadConsolidated, loadSupplierStatement } from '../../lib/statementData'
import { displayDate } from '../../lib/dates'
import { money } from '../../lib/format'

const ALL = ''

// Pick a Design Build project, or all of them.
function ProjectPicker({ value, onChange, projects }) {
  return (
    <select className="field-input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ALL}>All projects and company</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

function Summary({ total, opening, rows }) {
  const credit = rows.reduce((s, r) => s + (r.direction === 'in' ? Number(r.amount) : 0), 0)
  const debit = rows.reduce((s, r) => s + (r.direction === 'out' ? Number(r.amount) : 0), 0)
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <StatCard label="Total spend in period" value={money(total)} tone="bad" />
      <StatCard label="Brought forward" value={money(opening)} />
      <StatCard label="Credit (in)" value={money(credit)} />
      <StatCard label="Debit (out)" value={money(debit)} />
    </div>
  )
}

function CategoryTable({ categories, total }) {
  if (!total) return <EmptyState title="Nothing spent in this period" />
  return (
    <table className="table-base">
      <thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
      <tbody>
        {categories.map((c) => (
          <tr key={`${c.level || 0}-${c.name}`} className={c.level ? '' : 'bg-ink-50'}>
            <td className={c.level ? 'pl-8 text-ink-700' : 'font-medium'}>{c.name}</td>
            <td className="num">{money(c.amount)}</td>
            <td className="num">{total ? `${((c.amount / total) * 100).toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td className="font-medium">Total</td><td className="num font-medium">{money(total)}</td><td /></tr></tfoot>
    </table>
  )
}

// Consolidated report: any period, all projects or one project. Category breakdown first, then the ledger.
export function ConsolidatedReport() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [projectId, setProjectId] = useState(ALL)
  const projectsQ = useDesignProjects()
  const projects = projectsQ.data || []
  const projectName = projects.find((p) => p.id === projectId)?.name

  const q = useQuery({
    queryKey: ['consolidated_report', start, end, projectId],
    queryFn: () => loadConsolidated({ start, end, projectId: projectId || null }),
  })

  const period = `${displayDate(start)} – ${displayDate(end)}`
  const data = q.data

  return (
    <div>
      <PageHeader
        title="Consolidated report"
        subtitle="Every Design Build cost for a period, for all projects and the company, or for one project. Category breakdown, then the ledger."
      />
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
          <ProjectPicker value={projectId} onChange={setProjectId} projects={projects} />
        </div>
      </Card>
      {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load this report" hint={q.error.message} /> : data && (
        <>
          <Summary total={data.total} opening={data.opening} rows={data.rows} />
          <Card title="Category breakdown" className="mb-5"><CategoryTable categories={data.categories} total={data.total} /></Card>
          <Card title="Ledger">
            <BankStatement
              rows={data.rows}
              opening={data.opening}
              pdfTitle="Consolidated report"
              subtitle={projectName || 'All projects and company'}
              period={period}
              categories={data.categories}
              exportName={`consolidated-${projectName || 'all'}-${start}-to-${end}`}
            />
          </Card>
        </>
      )}
    </div>
  )
}

// Supplier and contractor list. Each one opens its statement.
export function SupplierList() {
  const q = useQuery({ queryKey: ['suppliers_list'], queryFn: listSuppliers })
  const [search, setSearch] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  function refresh() {
    qc.invalidateQueries({ queryKey: ['suppliers_list'] })
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  async function setActive(s, active) {
    const { error } = await supabase.from('suppliers').update({ active }).eq('id', s.id)
    if (error) return toast.error(error.message)
    toast.success(active ? `${s.name} is active again.` : `${s.name} deactivated.`)
    refresh()
  }

  // A vendor with no bills is deleted. One with bills keeps its history, so it can only be deactivated.
  async function remove(s) {
    const ok = await confirm(`Delete ${s.name}?`, { detail: 'This removes the vendor. It cannot be undone.', confirmLabel: 'Delete vendor' })
    if (!ok) return
    const { data, error } = await supabase.rpc('delete_supplier', { p_supplier_id: s.id })
    if (error) return toast.error(error.message)
    if (data?.result === 'deleted') {
      toast.success(`${s.name} deleted.`)
      return refresh()
    }
    const parts = []
    if (data?.bills) parts.push(`${data.bills} bill${data.bills === 1 ? '' : 's'}`)
    if (data?.returns) parts.push(`${data.returns} return slip${data.returns === 1 ? '' : 's'}`)
    const deactivate = await confirm(`${s.name} has ${parts.join(' and ')}`, {
      detail: 'A vendor with bills cannot be deleted without losing those records. Deactivate it instead? It stays in the books but no longer appears when choosing a vendor.',
      confirmLabel: 'Deactivate', tone: 'primary',
    })
    if (deactivate) setActive(s, false)
  }
  const rows = (q.data || []).filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div>
      <PageHeader title="Material Vendors" subtitle="Open a vendor to see their bills, invoices, payments, returns, stock and every credit and debit." />
      <Card className="mb-5">
        <input className="field-input max-w-sm" placeholder="Search suppliers and contractors" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>
      <Card>
        {q.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No suppliers or contractors found" /> : (
          <table className="table-base">
            <thead><tr><th>Name</th><th>GSTIN</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium"><Link className="hover:underline" to={`/design-build/suppliers/${s.id}`}>{s.name}</Link></td>
                  <td>{s.gstin || '—'}</td>
                  <td className="capitalize">{s.active === false ? 'Inactive' : 'Active'}</td>
                  <td className="text-right whitespace-nowrap">
                    <Link className="btn-ghost text-xs px-2" to={`/design-build/suppliers/${s.id}`}>Dashboard</Link>
                    {s.active === false && <button type="button" className="btn-ghost text-xs px-2" onClick={() => setActive(s, true)}>Reactivate</button>}
                    <button type="button" className="btn-ghost text-xs px-2 text-bad" onClick={() => remove(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

// One supplier or contractor's statement, for any period and optionally one project.
export function SupplierStatement() {
  const { id } = useParams()
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [projectId, setProjectId] = useState(ALL)
  const projectsQ = useDesignProjects()
  const projects = projectsQ.data || []

  const q = useQuery({
    queryKey: ['supplier_statement', id, start, end, projectId],
    queryFn: () => loadSupplierStatement({ supplierId: id, start, end, projectId: projectId || null }),
  })

  const data = q.data
  const period = `${displayDate(start)} – ${displayDate(end)}`

  return (
    <div>
      <PageHeader
        title={data?.supplier?.name || 'Supplier statement'}
        subtitle={data?.supplier?.gstin ? `GSTIN ${data.supplier.gstin}` : 'Bills raised, payments made, and the balance owed'}
        actions={<Link className="btn-secondary" to="/design-build/suppliers">All suppliers</Link>}
      />
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
          <ProjectPicker value={projectId} onChange={setProjectId} projects={projects} />
        </div>
      </Card>
      {q.isLoading ? <LoadingBlock /> : q.error ? <EmptyState title="Could not load this statement" hint={q.error.message} /> : data && (
        <>
          <Summary total={data.total} opening={data.opening} rows={data.rows} />
          <Card title="Category breakdown" className="mb-5"><CategoryTable categories={data.categories} total={data.total} /></Card>
          <Card title="Ledger">
            <BankStatement
              rows={data.rows}
              opening={data.opening}
              pdfTitle="Supplier statement"
              subtitle={data.supplier?.name}
              period={period}
              categories={data.categories}
              exportName={`supplier-statement-${(data.supplier?.name || 'supplier').replace(/[^a-z0-9]+/gi, '-')}-${start}-to-${end}`}
            />
          </Card>
        </>
      )}
    </div>
  )
}
