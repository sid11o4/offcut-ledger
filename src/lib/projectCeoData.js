import { supabase } from './supabaseClient'

// Everything the project CEO dashboard shows, from one load. The figures are computed from the raw rows
// so a date filter can be applied without a new query. A material's vendor is traced first-in, first-out
// through the stock ledger: each consumption is split across the purchases it drew from.

const NONE = '00000000-0000-0000-0000-000000000000'
const inList = (ids) => (ids.length ? ids : [NONE])
const ym = (d) => (d ? String(d).slice(0, 7) : '')
const num = (x) => Number(x || 0)

export async function loadProjectRaw(projectId) {
  const projectR = await supabase.from('design_projects')
    .select('id, code, name, status, start_date, expected_completion_date, budget, factory_project_id, clients(name)')
    .eq('id', projectId).single()
  if (projectR.error) throw projectR.error
  const project = projectR.data

  const [locR, billsR, expR, jobR, finR] = await Promise.all([
    supabase.from('inventory_locations').select('id').eq('design_project_id', projectId).maybeSingle(),
    supabase.from('supplier_bills')
      .select('id, internal_bill_number, bill_date, supplier_text, bill_source, cost_heads, grand_total, suppliers(name)')
      .eq('design_project_id', projectId).eq('status', 'approved'),
    supabase.from('design_build_expenses')
      .select('id, amount, expense_date, description, expense_categories(name)')
      .eq('design_project_id', projectId).eq('status', 'active'),
    project.factory_project_id
      ? supabase.from('job_work_entries')
        .select('id, entry_date, base_quantity, total_amount, job_work_services(name), units(code)')
        .eq('project_id', project.factory_project_id).eq('billed', true).eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('report_design_project_financials', { p_design_project_id: projectId }),
  ])
  for (const r of [locR, billsR, expR, jobR, finR]) if (r.error) throw r.error

  const locationId = locR.data?.id || null
  const bills = billsR.data || []
  const billIds = bills.map((b) => b.id)
  const billById = new Map(bills.map((b) => [b.id, b]))

  const itemsR = await supabase.from('supplier_bill_items')
    .select('id, bill_id, description, item_type, quantity, unit_text, total_amount, inventory_item_id, cost_head')
    .in('bill_id', inList(billIds))
  if (itemsR.error) throw itemsR.error

  // Consumption at this project, and every inbound purchase and outflow of the same materials, for the
  // first-in, first-out trace.
  const consR = locationId
    ? await supabase.from('inventory_transactions')
      .select('id, txn_date, created_at, quantity, total_cost, unit_cost, item_id, reference_type, location_id, inventory_items(name, units(code))')
      .eq('location_id', locationId).eq('txn_type', 'consumption')
    : { data: [], error: null }
  if (consR.error) throw consR.error
  const itemIds = [...new Set((consR.data || []).map((c) => c.item_id))]
  const flowR = itemIds.length
    ? await supabase.from('inventory_transactions')
      .select('id, txn_type, txn_date, created_at, quantity, unit_cost, reference_type, reference_id, item_id, location_id')
      .in('item_id', itemIds).in('txn_type', ['purchase', 'consumption', 'transfer_out'])
    : { data: [], error: null }
  if (flowR.error) throw flowR.error

  // The supplier of every purchase bill that stocked these materials, not only this project's bills.
  const purchaseBillIds = [...new Set((flowR.data || []).filter((f) => f.txn_type === 'purchase' && f.reference_type === 'supplier_bill').map((f) => f.reference_id))]
  const purchaseBillsR = purchaseBillIds.length
    ? await supabase.from('supplier_bills').select('id, internal_bill_number, supplier_text, suppliers(name)').in('id', purchaseBillIds)
    : { data: [], error: null }
  if (purchaseBillsR.error) throw purchaseBillsR.error

  return {
    project,
    locationId,
    financials: finR.data?.[0] || {},
    bills,
    billItems: itemsR.data || [],
    expenses: expR.data || [],
    jobWork: jobR.data || [],
    consumptions: consR.data || [],
    flows: flowR.data || [],
    purchaseBills: purchaseBillsR.data || [],
  }
}

// Vendor split of each consumption, first-in first-out per material.
function traceVendors(raw) {
  const billVendor = new Map(raw.purchaseBills.map((b) => [b.id, b.suppliers?.name || b.supplier_text || 'Vendor not recorded']))
  const byItem = new Map()
  for (const f of raw.flows) {
    if (!byItem.has(f.item_id)) byItem.set(f.item_id, [])
    byItem.get(f.item_id).push(f)
  }
  const shares = new Map() // consumption txn id -> [{ vendor, qty }]
  for (const [, events] of byItem) {
    events.sort((a, b) => String(a.txn_date).localeCompare(String(b.txn_date)) || String(a.created_at).localeCompare(String(b.created_at)))
    const lots = []
    for (const e of events) {
      const qty = num(e.quantity)
      if (e.txn_type === 'purchase' && qty > 0) {
        const vendor = e.reference_type === 'supplier_bill' ? billVendor.get(e.reference_id) || 'Vendor not recorded' : 'Company purchase (no vendor)'
        lots.push({ vendor, qty })
        continue
      }
      // Outflows: consumption and transfers out. Each takes from the oldest lots first.
      let need = Math.abs(qty)
      const taken = []
      while (need > 1e-9 && lots.length) {
        const lot = lots[0]
        const take = Math.min(lot.qty, need)
        taken.push({ vendor: lot.vendor, qty: take })
        lot.qty -= take
        need -= take
        if (lot.qty <= 1e-9) lots.shift()
      }
      if (need > 1e-9) taken.push({ vendor: 'No purchase on record', qty: need })
      if (e.txn_type === 'consumption') shares.set(e.id, taken)
    }
  }
  return shares
}

// Turns the raw load into the report, for a date range (inclusive; empty means all time).
export function computeProjectCeo(raw, { start = '', end = '' } = {}) {
  const inRange = (d) => (!start || String(d) >= start) && (!end || String(d) <= end)
  const shares = traceVendors(raw)

  // Materials consumed
  const consumed = raw.consumptions.filter((c) => inRange(c.txn_date))
  const matMap = new Map()
  const vendorMat = new Map()
  let materialsCost = 0
  for (const c of consumed) {
    const cost = Math.abs(num(c.total_cost))
    const qtyAbs = Math.abs(num(c.quantity))
    materialsCost += cost
    const name = c.inventory_items?.name || 'Unknown material'
    const unit = c.inventory_items?.units?.code || ''
    const row = matMap.get(name) || { name, unit, quantity: 0, cost: 0, vendors: new Map() }
    row.quantity += qtyAbs
    row.cost += cost
    matMap.set(name, row)
    const parts = shares.get(c.id) || []
    const total = parts.reduce((s, p) => s + p.qty, 0) || qtyAbs
    for (const p of parts) {
      const v = cost * (p.qty / total)
      row.vendors.set(p.vendor, (row.vendors.get(p.vendor) || 0) + v)
      vendorMat.set(p.vendor, (vendorMat.get(p.vendor) || 0) + v)
    }
    if (!parts.length) {
      row.vendors.set('No purchase on record', (row.vendors.get('No purchase on record') || 0) + cost)
      vendorMat.set('No purchase on record', (vendorMat.get('No purchase on record') || 0) + cost)
    }
  }
  const materials = [...matMap.values()].sort((a, b) => b.cost - a.cost)

  // Bills: labour, other (non-stock) and the vendor of each
  const billRows = raw.billItems.map((i) => {
    const b = raw.bills.find((x) => x.id === i.bill_id)
    return { ...i, billNumber: b?.internal_bill_number || '', date: b?.bill_date || '', vendor: b?.suppliers?.name || b?.supplier_text || 'Vendor not recorded', source: b?.bill_source || 'formgrid' }
  }).filter((r) => inRange(r.date))
  const labour = billRows.filter((r) => r.item_type === 'labour')
  const other = billRows.filter((r) => r.item_type !== 'labour' && !r.inventory_item_id)
  const labourCost = labour.reduce((s, r) => s + num(r.total_amount), 0)
  const labourQty = labour.reduce((s, r) => s + num(r.quantity), 0)
  const otherCost = other.reduce((s, r) => s + num(r.total_amount), 0)

  // Factory job-work (internal order)
  const jobs = raw.jobWork.filter((j) => inRange(j.entry_date))
  const factoryCost = jobs.reduce((s, j) => s + num(j.total_amount), 0)
  const jobMap = new Map()
  for (const j of jobs) {
    const name = j.job_work_services?.name || 'Job work'
    const row = jobMap.get(name) || { name, count: 0, quantity: 0, unit: j.units?.code || '', cost: 0 }
    row.count += 1; row.quantity += num(j.base_quantity); row.cost += num(j.total_amount)
    jobMap.set(name, row)
  }

  // Misc expenses by category
  const misc = raw.expenses.filter((e) => inRange(e.expense_date))
  const miscCost = misc.reduce((s, e) => s + num(e.amount), 0)
  const miscMap = new Map()
  for (const e of misc) {
    const cat = e.expense_categories?.name || 'Uncategorised'
    miscMap.set(cat, (miscMap.get(cat) || 0) + num(e.amount))
  }

  // Split of expenses
  const slices = [
    { key: 'materials', label: 'Materials consumed', value: materialsCost },
    { key: 'labour', label: 'Labour', value: labourCost },
    { key: 'factory', label: 'Factory job-work', value: factoryCost },
    { key: 'misc', label: 'Miscellaneous', value: miscCost },
    { key: 'other', label: 'Other bills', value: otherCost },
  ].filter((s) => s.value > 0)
  const total = slices.reduce((s, x) => s + x.value, 0)

  // Vendors: everyone money went to
  const vendorMap = new Map()
  const addVendor = (name, kind, amount) => {
    const v = vendorMap.get(name) || { name, total: 0, materials: 0, labour: 0, other: 0 }
    v.total += amount; v[kind] += amount
    vendorMap.set(name, v)
  }
  for (const [name, amount] of vendorMat) addVendor(name, 'materials', amount)
  for (const r of labour) addVendor(r.vendor, 'labour', num(r.total_amount))
  for (const r of other) addVendor(r.vendor, 'other', num(r.total_amount))
  const vendors = [...vendorMap.values()].sort((a, b) => b.total - a.total)

  // Monthly trend
  const months = new Map()
  const bump = (d, key, amount) => {
    const m = ym(d)
    if (!m) return
    const row = months.get(m) || { month: m, materials: 0, labour: 0, factory: 0, misc: 0, other: 0 }
    row[key] += amount
    months.set(m, row)
  }
  for (const c of consumed) bump(c.txn_date, 'materials', Math.abs(num(c.total_cost)))
  for (const r of labour) bump(r.date, 'labour', num(r.total_amount))
  for (const r of other) bump(r.date, 'other', num(r.total_amount))
  for (const j of jobs) bump(j.entry_date, 'factory', num(j.total_amount))
  for (const e of misc) bump(e.expense_date, 'misc', num(e.amount))
  const trend = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))

  const budget = num(raw.project.budget)
  const inventoryValue = num(raw.financials.current_inventory_value)

  return {
    project: raw.project,
    kpis: {
      budget,
      spent: total,
      used: budget ? total / budget : null,
      remaining: budget ? budget - total : null,
      inventoryValue,
      vendorCount: vendors.length,
      labourQty,
      jobCount: jobs.length,
    },
    slices,
    total,
    materials,
    materialsCost,
    vendorMaterials: [...vendorMat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    labour: labour.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    labourCost, labourQty,
    jobs: [...jobMap.values()].sort((a, b) => b.cost - a.cost),
    jobRows: jobs,
    factoryCost,
    misc: misc.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date))),
    miscByCategory: [...miscMap.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    miscCost,
    other: other.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    otherCost,
    vendors,
    trend,
  }
}
