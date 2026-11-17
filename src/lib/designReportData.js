import { groupCosts, loadCostBreakdown } from './costGroups'
import { supabase } from './supabaseClient'
import { buildTableDoc } from './reportPdf'
import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'

// Data for the Design Build detailed reports. The page and the PDF both read these loaders, so the
// figures on screen and in the PDF are the same numbers.

export async function loadProjectSummary() {
  const { data: projects, error } = await supabase.from('design_projects').select('id, name, code, status, clients(name)').order('name')
  if (error) throw error
  // Materials a project used before the system held its stock are a cost of the project too.
  const pastR = await supabase.from('past_material_consumption').select('design_project_id, total_cost').eq('voided', false)
  if (pastR.error) throw pastR.error
  const pastBy = new Map()
  for (const x of pastR.data || []) pastBy.set(x.design_project_id, (pastBy.get(x.design_project_id) || 0) + Number(x.total_cost))
  const fin = await Promise.all(projects.map(async (p) => {
    const [finR, conR] = await Promise.all([
      supabase.rpc('report_design_project_financials', { p_design_project_id: p.id }),
      supabase.rpc('project_contract_summary', { p_design_project_id: p.id }),
    ])
    if (finR.error) throw finR.error
    if (conR.error) throw conR.error
    return { f: finR.data?.[0] || {}, c: conR.data?.[0] || {} }
  }))
  return projects.map((p, i) => {
    const { f, c } = fin[i]
    const past = pastBy.get(p.id) || 0
    const spent = Number(f.supplier_bills_total || 0) + Number(f.internal_order_total || 0) + Number(f.direct_expenses_total || 0) + past
    const contract = Number(c.contract_total || 0)
    return { id: p.id, name: p.name, code: p.code, status: p.status, client: p.clients?.name || '', contract, bills: Number(f.supplier_bills_total || 0), internal: Number(f.internal_order_total || 0), direct: Number(f.direct_expenses_total || 0), past, spent, left: contract - spent }
  })
}

// Every Design Build cost in the period, in the report groups (Labour, Materials by kind, Factory Job Work,
// Transport, Miscellaneous), with the project or company each was charged to.
export async function loadExpensesByCategory(start, end) {
  const rows = await loadCostBreakdown({ start, end })
  return { rows, grand: rows.reduce((s, r) => s + Number(r.amount), 0) }
}

export async function loadMaterials(start, end) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('quantity, total_cost, inventory_items(name, units(code)), inventory_locations(design_project_id, design_projects(name))')
    .eq('txn_type', 'consumption').is('reversed_by', null).gte('txn_date', start).lte('txn_date', end)
  if (error) throw error
  // Past consumption (used before the system held stock) counts too; it was never taken from inventory.
  const past = await supabase.from('past_material_consumption')
    .select('quantity, total_cost, design_projects(name), inventory_items(name, units(code))')
    .eq('voided', false).gte('consumed_on', start).lte('consumed_on', end)
  if (past.error) throw past.error
  const rows = [
    ...(data || []).filter((x) => x.inventory_locations?.design_project_id).map((t) => ({
      project: t.inventory_locations.design_projects?.name || 'Project', item: t.inventory_items, quantity: t.quantity, total_cost: t.total_cost,
    })),
    ...(past.data || []).map((x) => ({ project: x.design_projects?.name || 'Project', item: x.inventory_items, quantity: x.quantity, total_cost: x.total_cost })),
  ]
  const byProject = new Map()
  for (const t of rows) {
    const project = t.project
    const item = t.item?.name || 'Unknown item'
    const p = byProject.get(project) || { name: project, items: new Map(), cost: 0 }
    const row = p.items.get(item) || { name: item, unit: t.item?.units?.code || '', quantity: 0, cost: 0 }
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
    const contract = rows.reduce((s, r) => s + r.contract, 0)
    const spent = rows.reduce((s, r) => s + r.spent, 0)
    return buildTableDoc({
      title, subtitle, meta,
      cards: [['Total contract value', money(contract)], ['Total spent', money(spent)], ['Total left of contract', money(contract - spent)]],
      sections: [{
        heading: 'Projects',
        head: ['Project', 'Client', 'Status', 'Contract value', 'Supplier bills', 'Design Build Order', 'Direct', 'Past consumption', 'Spent', 'Left of contract'],
        body: rows.map((r) => [r.name, r.client || '—', r.status, r.contract ? money(r.contract) : '—', money(r.bills), money(r.internal), money(r.direct), money(r.past), money(r.spent), r.contract ? money(r.left) : '—']),
        foot: ['Total', '', '', money(contract), '', '', '', money(rows.reduce((t, r) => t + r.past, 0)), money(spent), money(contract - spent)],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
      }],
    })
  }
  if (section === 'expenses') {
    const body = []
    const pct = (v, of) => (of ? `${((v / of) * 100).toFixed(1)}%` : '—')
    for (const g of groupCosts(data.rows).groups) {
      body.push([g.name, '', money(g.total), pct(g.total, data.grand)])
      if (g.subs) for (const sub of g.subs) body.push([`    ${sub.name}`, '', money(sub.amount), pct(sub.amount, g.total)])
      for (const [place, amount] of [...g.places.entries()].sort((a, b) => b[1] - a[1])) body.push([`      charged to ${place}`, '', money(amount), pct(amount, g.total)])
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
