import { supabase } from './supabaseClient'
import { buildTableDoc } from './reportPdf'
import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'

// Data for the Design Build detailed reports. The page and the PDF both read these loaders, so the
// figures on screen and in the PDF are the same numbers.

export async function loadProjectSummary() {
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
    return { id: p.id, name: p.name, code: p.code, status: p.status, client: p.clients?.name || '', budget: Number(p.budget || 0), bills: Number(f.supplier_bills_total || 0), internal: Number(f.internal_order_total || 0), direct: Number(f.direct_expenses_total || 0), spent, headroom: Number(p.budget || 0) - spent }
  })
}

export async function loadExpensesByCategory(start, end) {
  const { data, error } = await supabase
    .from('design_build_expenses')
    .select('amount, design_project_id, expense_categories(name), design_projects(name)')
    .eq('status', 'active').gte('expense_date', start).lte('expense_date', end)
  if (error) throw error
  const byCategory = new Map()
  for (const r of data || []) {
    const cat = r.expense_categories?.name || 'Uncategorised'
    const place = r.design_projects?.name || 'Company'
    const entry = byCategory.get(cat) || { name: cat, total: 0, places: new Map() }
    entry.total += Number(r.amount)
    entry.places.set(place, (entry.places.get(place) || 0) + Number(r.amount))
    byCategory.set(cat, entry)
  }
  const categories = [...byCategory.values()]
    .map((c) => ({ name: c.name, total: c.total, places: [...c.places.entries()].sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.total - a.total)
  return { categories, grand: categories.reduce((s, c) => s + c.total, 0) }
}

export async function loadMaterials(start, end) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('quantity, total_cost, inventory_items(name, units(code)), inventory_locations(design_project_id, design_projects(name))')
    .eq('txn_type', 'consumption').gte('txn_date', start).lte('txn_date', end)
  if (error) throw error
  const byProject = new Map()
  for (const t of (data || []).filter((x) => x.inventory_locations?.design_project_id)) {
    const project = t.inventory_locations.design_projects?.name || 'Project'
    const item = t.inventory_items?.name || 'Unknown item'
    const p = byProject.get(project) || { name: project, items: new Map(), cost: 0 }
    const row = p.items.get(item) || { name: item, unit: t.inventory_items?.units?.code || '', quantity: 0, cost: 0 }
    row.quantity += Math.abs(Number(t.quantity))
    row.cost += Math.abs(Number(t.total_cost))
    p.items.set(item, row)
    p.cost += Math.abs(Number(t.total_cost))
    byProject.set(project, p)
  }
  const projects = [...byProject.values()]
    .map((p) => ({ name: p.name, cost: p.cost, items: [...p.items.values()].sort((a, b) => b.cost - a.cost) }))
    .sort((a, b) => b.cost - a.cost)
  return { projects, grand: projects.reduce((s, p) => s + p.cost, 0) }
}

export async function loadLabour(start, end) {
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
      description: x.description || 'Labour', party: x.expense_categories?.name || '', amount: Number(x.amount),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) }
}

// The PDF for one Design Build report section, built from the same data the page shows.
export function designReportPdf(section, data, { title, subtitle, period }) {
  const meta = period ? [['Period', period]] : []
  if (section === 'projects') {
    const rows = data
    const budget = rows.reduce((s, r) => s + r.budget, 0)
    const spent = rows.reduce((s, r) => s + r.spent, 0)
    return buildTableDoc({
      title, subtitle, meta,
      cards: [['Total budget', money(budget)], ['Total spent', money(spent)], ['Total headroom', money(budget - spent)]],
      sections: [{
        heading: 'Projects',
        head: ['Project', 'Client', 'Status', 'Budget', 'Supplier bills', 'Internal Order', 'Direct', 'Spent', 'Headroom'],
        body: rows.map((r) => [r.name, r.client || '—', r.status, r.budget ? money(r.budget) : '—', money(r.bills), money(r.internal), money(r.direct), money(r.spent), r.budget ? money(r.headroom) : '—']),
        foot: ['Total', '', '', money(budget), '', '', '', money(spent), money(budget - spent)],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
      }],
    })
  }
  if (section === 'expenses') {
    const body = []
    for (const c of data.categories) {
      body.push([c.name, '', money(c.total), data.grand ? `${((c.total / data.grand) * 100).toFixed(1)}%` : '—'])
      for (const [place, amount] of c.places) body.push([`    ${place}`, '', money(amount), c.total ? `${((amount / c.total) * 100).toFixed(1)}%` : '—'])
    }
    return buildTableDoc({
      title, subtitle, meta,
      cards: [['Total expenses', money(data.grand)]],
      sections: [{
        heading: 'By category, then by project or company',
        head: ['Category / charged to', '', 'Amount', 'Share'],
        body,
        foot: ['Total', '', money(data.grand), '100%'],
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      }],
    })
  }
  if (section === 'materials') {
    const body = []
    for (const p of data.projects) {
      body.push([p.name, '', money(p.cost)])
      for (const i of p.items) body.push([`    ${i.name}`, `${qty(i.quantity)} ${i.unit}`.trim(), money(i.cost)])
    }
    return buildTableDoc({
      title, subtitle, meta,
      cards: [['Materials consumed', money(data.grand)]],
      sections: [{
        heading: 'By project, then by material',
        head: ['Project / material', 'Quantity', 'Cost'],
        body,
        foot: ['Total', '', money(data.grand)],
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      }],
    })
  }
  // labour
  return buildTableDoc({
    title, subtitle, meta,
    cards: [['Total labour', money(data.total)]],
    sections: [{
      heading: 'Labour',
      head: ['Date', 'Project', 'Description', 'Supplier / category', 'Cost'],
      body: data.lines.map((l) => [displayDate(l.date), l.project, l.description, l.party, money(l.amount)]),
      foot: ['', '', '', 'Total', money(data.total)],
      columnStyles: { 4: { halign: 'right' } },
    }],
  })
}
