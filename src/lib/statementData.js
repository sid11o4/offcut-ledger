import { supabase } from './supabaseClient'

// Consolidated Design Build reports and supplier / contractor statements. Each returns the category
// breakdown and the ledger rows in the shape BankStatement and the statement PDF already use.

const FAR_PAST = '2000-01-01'

// Cost heads on supplier bills, with the labels the Bill Audit Queue shows.
export const COST_HEAD_LABEL = {
  factory_labour: 'Factory Labour', factory_consumables: 'Factory Consumables', site_labour: 'Site Labour',
  raw_boards: 'Raw Boards', laminate_veneer: 'Laminate and Veneer', fevicol_adhesives: 'Fevicol / Adhesives',
  employee_salary: 'Employee Salary', other: 'Other',
}

function inPeriod(date, start, end) {
  return date >= start && date <= end
}

// Splits a bill's amount equally across its cost heads; a bill with none goes to "Uncategorised".
function headsOf(bill) {
  const heads = (bill.cost_heads || []).filter(Boolean)
  return heads.length ? heads : ['uncategorised']
}

export async function listSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('id, name, gstin, active').order('name')
  if (error) throw error
  return data || []
}

// Consolidated report for a period, optionally for one Design Build project. Company-level rows are
// included only when no project is chosen.
export async function loadConsolidated({ start, end, projectId }) {
  const [billsR, expensesR, ledgerR] = await Promise.all([
    supabase.from('supplier_bills')
      .select('bill_date, grand_total, cost_heads, design_project_id, internal_bill_number, supplier_text, suppliers(name)')
      .eq('status', 'approved').gte('bill_date', start).lte('bill_date', end),
    supabase.from('design_build_expenses')
      .select('expense_date, amount, description, design_project_id, expense_categories(name)')
      .eq('status', 'active').gte('expense_date', start).lte('expense_date', end),
    supabase.rpc('design_build_ledger', { p_start: FAR_PAST, p_end: end }),
  ])
  for (const r of [billsR, expensesR, ledgerR]) if (r.error) throw r.error

  const inScope = (pid) => (projectId ? pid === projectId : true)
  const bills = (billsR.data || []).filter((b) => inScope(b.design_project_id))
  const expenses = (expensesR.data || []).filter((x) => inScope(x.design_project_id))
  const ledgerAll = (ledgerR.data || []).filter((r) => inScope(r.design_project_id)).reverse() // oldest first

  const byCategory = new Map()
  const add = (name, amount) => byCategory.set(name, (byCategory.get(name) || 0) + amount)
  for (const b of bills) {
    const heads = headsOf(b)
    for (const h of heads) add(`Supplier bills — ${COST_HEAD_LABEL[h] || h}`, Number(b.grand_total) / heads.length)
  }
  for (const r of ledgerAll.filter((r) => r.category === 'Internal Order' && inPeriod(r.txn_date, start, end))) {
    add('Internal Order (Factory job-work)', Number(r.amount))
  }
  for (const x of expenses) add(`Expense — ${x.expense_categories?.name || 'Uncategorised'}`, Number(x.amount))

  const categories = [...byCategory.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
  const total = categories.reduce((s, c) => s + c.amount, 0)

  // Ledger: money out in the period, with the balance brought forward from before the period.
  const opening = ledgerAll.filter((r) => r.txn_date < start).reduce((s, r) => s + Number(r.amount), 0)
  const rows = ledgerAll.filter((r) => inPeriod(r.txn_date, start, end)).map((r, i) => ({
    key: `${r.reference_type}-${r.reference_id}-${i}`,
    date: r.txn_date,
    category: r.category,
    description: r.project_name ? `${r.project_name}${r.description ? ` — ${r.description}` : ''}` : (r.description || 'Company'),
    reference: r.reference,
    direction: 'out',
    amount: Number(r.amount),
  }))
  return { categories, total, opening: -opening, rows }
}

// A supplier's statement: bills raised (credit) and payments made (debit), with the balance owed.
// Category breakdown is the cost heads of the bills in the period.
export async function loadSupplierStatement({ supplierId, start, end, projectId }) {
  const [supplierR, billsR, paymentsR, returnsR] = await Promise.all([
    supabase.from('suppliers').select('id, name, gstin, address').eq('id', supplierId).single(),
    supabase.from('supplier_bills')
      .select('id, internal_bill_number, bill_date, grand_total, cost_heads, design_project_id, design_projects(name)')
      .eq('supplier_id', supplierId).eq('status', 'approved'),
    supabase.from('supplier_bill_payments')
      .select('id, mode, allocated_amount, confirmed, confirmed_at, created_at, utr_reference, bill:supplier_bills!inner(supplier_id, status, design_project_id, internal_bill_number, design_projects(name))')
      .eq('bill.supplier_id', supplierId).eq('bill.status', 'approved'),
    supabase.from('supplier_return_slips')
      .select('id, slip_number, return_date, total_amount, location:inventory_locations(design_project_id, name, kind)')
      .eq('supplier_id', supplierId),
  ])
  for (const r of [supplierR, billsR, paymentsR, returnsR]) if (r.error) throw r.error

  const inScope = (pid) => (projectId ? pid === projectId : true)
  const bills = (billsR.data || []).filter((b) => inScope(b.design_project_id))
  const payments = (paymentsR.data || [])
    .filter((p) => inScope(p.bill?.design_project_id))
    .filter((p) => p.mode === 'cash' || (p.mode === 'rtgs_neft' && p.confirmed))
    .map((p) => ({ ...p, date: (p.confirmed_at || p.created_at || '').slice(0, 10) }))
    .filter((p) => p.date)

  // Category breakdown: bills in the period by cost head.
  const byHead = new Map()
  for (const b of bills.filter((b) => inPeriod(b.bill_date, start, end))) {
    const heads = headsOf(b)
    for (const h of heads) byHead.set(h, (byHead.get(h) || 0) + Number(b.grand_total) / heads.length)
  }
  const categories = [...byHead.entries()]
    .map(([h, amount]) => ({ name: COST_HEAD_LABEL[h] || (h === 'uncategorised' ? 'Uncategorised' : h), amount }))
    .sort((a, b) => b.amount - a.amount)

  // Balance brought forward: everything billed and paid before the period.
  // Goods returned to the supplier reduce what is owed, so they count as payments on the statement.
  const returns = (returnsR.data || []).filter((r) => (projectId ? r.location?.design_project_id === projectId : true))
  const billedBefore = bills.filter((b) => b.bill_date < start).reduce((s, b) => s + Number(b.grand_total), 0)
  const paidBefore = payments.filter((p) => p.date < start).reduce((s, p) => s + Number(p.allocated_amount), 0)
  const returnedBefore = returns.filter((r) => r.return_date < start).reduce((s, r) => s + Number(r.total_amount), 0)
  const opening = billedBefore - paidBefore - returnedBefore

  const entries = [
    ...bills.filter((b) => inPeriod(b.bill_date, start, end)).map((b) => ({
      key: `bill-${b.id}`, date: b.bill_date, category: 'Bill',
      description: [b.design_projects?.name, (b.cost_heads || []).map((h) => COST_HEAD_LABEL[h] || h).join(', ')].filter(Boolean).join(' — '),
      reference: b.internal_bill_number, direction: 'in', amount: Number(b.grand_total),
    })),
    ...returns.filter((r) => inPeriod(r.return_date, start, end)).map((r) => ({
      key: `return-${r.id}`, date: r.return_date, category: 'Return to supplier',
      description: r.location?.name || '', reference: r.slip_number, direction: 'out', amount: Number(r.total_amount),
    })),
    ...payments.filter((p) => inPeriod(p.date, start, end)).map((p) => ({
      key: `pay-${p.id}`, date: p.date, category: 'Payment',
      description: [p.bill?.design_projects?.name, p.mode === 'cash' ? 'Cash' : 'RTGS / NEFT'].filter(Boolean).join(' — '),
      reference: p.utr_reference || p.bill?.internal_bill_number, direction: 'out', amount: Number(p.allocated_amount),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  const total = categories.reduce((s, c) => s + c.amount, 0)
  return { supplier: supplierR.data, categories, total, opening, rows: entries }
}
