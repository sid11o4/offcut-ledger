import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, EmptyState, LoadingBlock, StatCard } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Design Build's detailed reports. One page, four sections, each reachable from its own sidebar
// subheader: Projects, Expenses, Materials and Labour. Every section takes the same date range.
export const DESIGN_REPORT_SECTIONS = {
  projects: { title: 'Project summary', subtitle: 'Every Design Build project with its budget, spend and headroom.' },
  expenses: { title: 'Expenses by category', subtitle: 'Design Build expenses grouped by category, with the split by project or company.' },
  materials: { title: 'Materials consumed', subtitle: 'Stock used on each project in the period, at average cost.' },
  labour: { title: 'Labour', subtitle: 'Labour bills and labour expenses in the period, by project.' },
}

function Range({ start, end, setStart, setEnd }) {
  return <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>
}

function ProjectSummary() {
  const q = useQuery({
    queryKey: ['design_report_projects'],
    queryFn: async () => {
      const { data: projects, error } = await supabase.from('design_projects').select('id, name, code, status, budget, clients(name)').order('name')
      if (error) throw error
      const fin = await Promise.all(projects.map(async (p) => {
        const { data, error: fe } = await supabase.rpc('report_design_project_financials', { p_design_project_id: p.id })
        if (fe) throw fe
        return data?.[0] || {}
      }))
      return projects.map((p, i) => {
        const f = fin[i]
        const spent = Number(f.supplier_bills_total || 0) + Number(f.internal_order_total || 0) + Number(f.direct_expenses_total || 0)
        return { ...p, ...f, spent, headroom: Number(p.budget || 0) - spent }
      })
    },
  })
  const rows = q.data || []
  if (q.isLoading) return <LoadingBlock />
  if (!rows.length) return <EmptyState title="No Design Build projects yet" />
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const totalBudget = rows.reduce((s, r) => s + Number(r.budget || 0), 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total budget" value={money(totalBudget)} />
        <StatCard label="Total spent" value={money(totalSpent)} tone="bad" />
        <StatCard label="Total headroom" value={money(totalBudget - totalSpent)} tone={totalBudget - totalSpent >= 0 ? 'ok' : 'bad'} />
      </div>
      <Card>
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th className="num">Budget</th><th className="num">Supplier bills</th><th className="num">Internal Order</th><th className="num">Direct</th><th className="num">Spent</th><th className="num">Headroom</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.clients?.name || '—'}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="num">{r.budget ? money(r.budget) : '—'}</td>
                  <td className="num">{money(r.supplier_bills_total)}</td>
                  <td className="num">{money(r.internal_order_total)}</td>
                  <td className="num">{money(r.direct_expenses_total)}</td>
                  <td className="num font-medium">{money(r.spent)}</td>
                  <td className={`num ${r.headroom >= 0 ? 'text-ok' : 'text-bad'}`}>{r.budget ? money(r.headroom) : '—'}</td>
                  <td className="text-right"><Link className="btn-ghost text-xs px-2" to={`/design-build/projects/${r.id}/report`}>Report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function ExpensesByCategory({ start, end }) {
  const q = useQuery({
    queryKey: ['design_report_expenses', start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_build_expenses')
        .select('amount, design_project_id, expense_categories(name), design_projects(name)')
        .eq('status', 'active').gte('expense_date', start).lte('expense_date', end)
      if (error) throw error
      return data || []
    },
  })
  if (q.isLoading) return <LoadingBlock />
  const rows = q.data || []
  if (!rows.length) return <EmptyState title="No Design Build expenses in this period" />

  // Category, then the split by project or company, biggest first.
  const byCategory = new Map()
  for (const r of rows) {
    const cat = r.expense_categories?.name || 'Uncategorised'
    const place = r.design_projects?.name || 'Company'
    const entry = byCategory.get(cat) || { name: cat, total: 0, places: new Map() }
    entry.total += Number(r.amount)
    entry.places.set(place, (entry.places.get(place) || 0) + Number(r.amount))
    byCategory.set(cat, entry)
  }
  const categories = [...byCategory.values()].sort((a, b) => b.total - a.total)
  const grand = categories.reduce((s, c) => s + c.total, 0)

  return (
    <Card>
      <div className="overflow-x-auto -mx-4">
        <table className="table-base">
          <thead><tr><th>Category / charged to</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRows key={c.name} category={c} grand={grand} />
            ))}
          </tbody>
          <tfoot><tr><td className="font-medium">Total</td><td className="num font-medium">{money(grand)}</td><td /></tr></tfoot>
        </table>
      </div>
    </Card>
  )
}

function CategoryRows({ category, grand }) {
  const places = [...category.places.entries()].sort((a, b) => b[1] - a[1])
  return (
    <>
      <tr className="bg-ink-50">
        <td className="font-medium">{category.name}</td>
        <td className="num font-medium">{money(category.total)}</td>
        <td className="num">{grand ? `${((category.total / grand) * 100).toFixed(1)}%` : '—'}</td>
      </tr>
      {places.map(([place, amount]) => (
        <tr key={place}>
          <td className="pl-8 text-ink-600">{place}</td>
          <td className="num">{money(amount)}</td>
          <td className="num text-ink-500">{category.total ? `${((amount / category.total) * 100).toFixed(1)}%` : '—'}</td>
        </tr>
      ))}
    </>
  )
}

function MaterialsConsumed({ start, end }) {
  const q = useQuery({
    queryKey: ['design_report_materials', start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('quantity, total_cost, inventory_items(name, units(code)), inventory_locations(design_project_id, design_projects(name))')
        .eq('txn_type', 'consumption').gte('txn_date', start).lte('txn_date', end)
      if (error) throw error
      return data || []
    },
  })
  if (q.isLoading) return <LoadingBlock />
  const rows = (q.data || []).filter((t) => t.inventory_locations?.design_project_id)
  if (!rows.length) return <EmptyState title="No materials consumed in this period" />

  const byProject = new Map()
  for (const t of rows) {
    const project = t.inventory_locations.design_projects?.name || 'Project'
    const item = t.inventory_items?.name || 'Unknown item'
    const p = byProject.get(project) || { name: project, items: new Map(), cost: 0 }
    const row = p.items.get(item) || { name: item, unit: t.inventory_items?.units?.code, quantity: 0, cost: 0 }
    row.quantity += Math.abs(Number(t.quantity))
    row.cost += Math.abs(Number(t.total_cost))
    p.items.set(item, row)
    p.cost += Math.abs(Number(t.total_cost))
    byProject.set(project, p)
  }
  const projects = [...byProject.values()].sort((a, b) => b.cost - a.cost)

  return (
    <Card>
      <div className="overflow-x-auto -mx-4">
        <table className="table-base">
          <thead><tr><th>Project / material</th><th className="num">Quantity</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <ProjectMaterialRows key={p.name} project={p} />
            ))}
          </tbody>
          <tfoot><tr><td className="font-medium">Total</td><td /><td className="num font-medium">{money(projects.reduce((s, p) => s + p.cost, 0))}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  )
}

function ProjectMaterialRows({ project }) {
  const items = [...project.items.values()].sort((a, b) => b.cost - a.cost)
  return (
    <>
      <tr className="bg-ink-50">
        <td className="font-medium">{project.name}</td><td />
        <td className="num font-medium">{money(project.cost)}</td>
      </tr>
      {items.map((i) => (
        <tr key={i.name}>
          <td className="pl-8">{i.name}</td>
          <td className="num">{qty(i.quantity)} {i.unit}</td>
          <td className="num">{money(i.cost)}</td>
        </tr>
      ))}
    </>
  )
}

function LabourReport({ start, end }) {
  const q = useQuery({
    queryKey: ['design_report_labour', start, end],
    queryFn: async () => {
      const [bills, expenses] = await Promise.all([
        supabase.from('supplier_bills')
          .select('bill_date, remarks, supplier_text, grand_total, design_projects(name), suppliers(name)')
          .eq('expense_nature', 'labour').eq('status', 'approved')
          .gte('bill_date', start).lte('bill_date', end),
        supabase.from('design_build_expenses')
          .select('expense_date, description, amount, expense_categories(name), design_projects(name)')
          .eq('status', 'active').gte('expense_date', start).lte('expense_date', end),
      ])
      if (bills.error) throw bills.error
      if (expenses.error) throw expenses.error
      const lines = [
        ...(bills.data || []).map((b) => ({
          date: b.bill_date, project: b.design_projects?.name || 'Company',
          description: b.remarks || 'Labour bill', party: b.suppliers?.name || b.supplier_text || '—', amount: Number(b.grand_total),
        })),
        ...(expenses.data || []).filter((x) => /labour/i.test(x.expense_categories?.name || '')).map((x) => ({
          date: x.expense_date, project: x.design_projects?.name || 'Company',
          description: x.description || 'Labour', party: x.expense_categories?.name, amount: Number(x.amount),
        })),
      ]
      return lines.sort((a, b) => String(a.date).localeCompare(String(b.date)))
    },
  })
  if (q.isLoading) return <LoadingBlock />
  const lines = q.data || []
  if (!lines.length) return <EmptyState title="No labour recorded in this period" />

  const byProject = new Map()
  for (const l of lines) byProject.set(l.project, (byProject.get(l.project) || 0) + l.amount)
  const total = lines.reduce((s, l) => s + l.amount, 0)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total labour" value={money(total)} tone="bad" />
        {[...byProject.entries()].slice(0, 2).map(([name, amount]) => (
          <StatCard key={name} label={name} value={money(amount)} />
        ))}
      </div>
      <Card>
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Date</th><th>Project</th><th>Description</th><th>Supplier / category</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}><td>{displayDate(l.date)}</td><td>{l.project}</td><td>{l.description}</td><td>{l.party}</td><td className="num">{money(l.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="font-medium">Total</td><td className="num font-medium">{money(total)}</td></tr></tfoot>
          </table>
        </div>
      </Card>
    </>
  )
}

export default function DesignReports({ section }) {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const meta = DESIGN_REPORT_SECTIONS[section]

  return (
    <div>
      <PageHeader title={meta.title} subtitle={meta.subtitle} />
      {section !== 'projects' && <Range start={start} end={end} setStart={setStart} setEnd={setEnd} />}
      {section === 'projects' && <ProjectSummary />}
      {section === 'expenses' && <ExpensesByCategory start={start} end={end} />}
      {section === 'materials' && <MaterialsConsumed start={start} end={end} />}
      {section === 'labour' && <LabourReport start={start} end={end} />}
    </div>
  )
}
