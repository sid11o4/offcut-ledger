import { supabase } from './supabaseClient'

// Everything the vendor dashboard shows, for one supplier or contractor: their bills, invoices and tax
// invoices, payments, returns, the stock bought from them, and one ledger of credits and debits.
// Balances are owed to the vendor (positive = we owe them): bills add to it; payments, round-offs
// and returns reduce it. A voided bill counts for nothing.

const NONE = '00000000-0000-0000-0000-000000000000'
const inList = (ids) => (ids.length ? ids : [NONE])

function check(...results) {
  for (const r of results) if (r?.error) throw r.error
}

export async function loadVendorDashboard(supplierId) {
  const [supplierR, billsR, returnsR] = await Promise.all([
    supabase.from('suppliers').select('id, name, gstin, active').eq('id', supplierId).single(),
    supabase.from('supplier_bills')
      .select('id, internal_bill_number, bill_date, bill_source, status, grand_total, cost_heads, design_project_id, design_projects(name), approved_at, voided_at, void_reason')
      .eq('supplier_id', supplierId).order('bill_date'),
    supabase.from('supplier_return_slips')
      .select('id, slip_number, return_date, reason, total_amount, follow_up_status, slip_filed_reference, slip_filed_on, credit_status, credit_note_number, credit_note_date, credit_amount, credit_settled_how, credit_settled_on, credit_settled_reference, adjusted_bill_id, next_follow_up_on, location:inventory_locations(name, kind, design_projects(name))')
      .eq('supplier_id', supplierId).order('return_date'),
  ])
  check(supplierR, billsR, returnsR)

  const bills = billsR.data || []
  const billIds = bills.map((b) => b.id)
  const slips = returnsR.data || []
  const slipIds = slips.map((s) => s.id)

  const [itemsR, paymentsR, annexR, gstR, slipItemsR, purchasesR] = await Promise.all([
    supabase.from('supplier_bill_items')
      .select('id, bill_id, description, item_type, quantity, unit_text, rate_inclusive, gst_percent, total_amount, inventory_item_id')
      .in('bill_id', inList(billIds)),
    supabase.from('supplier_bill_payments')
      .select('id, bill_id, mode, allocated_amount, utr_reference, confirmed, confirmed_at, created_at')
      .in('bill_id', inList(billIds)),
    supabase.from('supplier_bill_annexures')
      .select('id, bill_id, kind, file_name, file_path, created_at')
      .in('bill_id', inList(billIds)),
    supabase.from('gst_invoice_followups').select('bill_id, status, next_action').in('bill_id', inList(billIds)),
    supabase.from('supplier_return_slip_items')
      .select('id, slip_id, item_id, quantity, unit_cost, total_amount, inventory_items(name, units(code))')
      .in('slip_id', inList(slipIds)),
    supabase.from('inventory_transactions')
      .select('id, txn_date, quantity, unit_cost, total_cost, reference_id, item_id, inventory_items(name, units(code))')
      .eq('txn_type', 'purchase').eq('reference_type', 'supplier_bill').in('reference_id', inList(billIds)),
  ])
  check(itemsR, paymentsR, annexR, gstR, slipItemsR, purchasesR)

  const itemIds = [...new Set((purchasesR.data || []).map((p) => p.item_id))]
  const stockR = itemIds.length
    ? await supabase.from('inventory_stock')
      .select('item_id, quantity, avg_unit_cost, location_id, inventory_locations(name, kind, design_projects(name)), inventory_items(name, units(code))')
      .in('item_id', itemIds).gt('quantity', 0)
    : { data: [], error: null }
  check(stockR)

  const billById = new Map(bills.map((b) => [b.id, b]))
  // A FORMGRID bill that paid vendor credit ('applied') has put its payments on the vendor's bills; it is not a bill itself.
  const live = bills.filter((b) => b.status !== 'void' && b.status !== 'applied')
  const billLabel = (b) => (b.bill_source === 'vendor' ? 'Vendor bill' : 'FORMGRID bill')
  const projectOf = (b) => b.design_projects?.name || 'Factory'

  // Payments that have actually gone out, the round-offs, and the credits recorded against each bill.
  const payments = (paymentsR.data || []).filter((p) => billById.get(p.bill_id)?.status !== 'void')
  const paidOf = (p) => (p.mode === 'cash' || (p.mode === 'rtgs_neft' && p.confirmed)) ? Number(p.allocated_amount) : 0
  const waiverOf = (p) => (p.mode === 'waiver' ? Number(p.allocated_amount) : 0)
  const totalBilled = live.reduce((s, b) => s + Number(b.grand_total || 0), 0)
  const totalPaid = payments.reduce((s, p) => s + paidOf(p), 0)
  const totalWaived = payments.reduce((s, p) => s + waiverOf(p), 0)
  // The credit a return earns is what the vendor's credit note says, or the value of the stock until it does.
  const creditOf = (r) => Number(r.credit_amount ?? r.total_amount ?? 0)
  const totalReturned = slips.reduce((s, r) => s + creditOf(r), 0)
  // Credit the vendor has paid back is cash received, so it no longer reduces what is owed.
  const refunded = slips.filter((r) => r.credit_settled_how === 'refunded').reduce((s, r) => s + creditOf(r), 0)
  const creditPending = slips.filter((r) => r.credit_status !== 'settled').reduce((s, r) => s + creditOf(r), 0)
  const balance = totalBilled - totalPaid - totalWaived - totalReturned + refunded

  // One ledger: bills (credits), payments, round-offs and returns (debits), oldest first.
  const entries = []
  for (const b of live) {
    entries.push({
      key: `bill-${b.id}`, date: b.bill_date, kind: 'Credit', type: billLabel(b),
      reference: b.internal_bill_number, description: projectOf(b), credit: Number(b.grand_total || 0), debit: 0,
    })
  }
  for (const p of payments) {
    const b = billById.get(p.bill_id)
    const date = (p.confirmed_at || p.created_at || '').slice(0, 10)
    if (!date) continue
    if (p.mode === 'credit') continue // the bill itself is already the credit
    const amount = p.mode === 'waiver' ? waiverOf(p) : paidOf(p)
    if (!amount) continue
    entries.push({
      key: `pay-${p.id}`, date,
      kind: 'Debit',
      type: p.mode === 'waiver' ? 'Round off / waive off' : p.mode === 'cash' ? 'Cash payment' : 'RTGS / NEFT payment',
      reference: p.utr_reference || b?.internal_bill_number || '',
      description: b ? projectOf(b) : '',
      credit: 0, debit: amount,
    })
  }
  for (const r of slips) {
    entries.push({
      key: `ret-${r.id}`, date: r.return_date, kind: 'Debit', type: 'Return to supplier',
      reference: r.slip_number, description: r.location?.name || '', credit: 0, debit: creditOf(r),
    })
    if (r.credit_settled_how === 'refunded') {
      entries.push({
        key: `refund-${r.id}`, date: r.credit_settled_on || r.return_date, kind: 'Credit', type: 'Refund received from vendor',
        reference: r.credit_settled_reference || r.slip_number, description: `Credit for ${r.slip_number}`, credit: creditOf(r), debit: 0,
      })
    }
  }
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.kind === 'Credit' ? -1 : 1))
  let running = 0
  const ledger = entries.map((e) => {
    running += e.credit - e.debit
    return { ...e, balance: running }
  })

  // Per bill: what is paid, what is waived, what is still owed, and its GST follow-up.
  const gstByBill = new Map((gstR.data || []).map((g) => [g.bill_id, g]))
  const annexByBill = new Map()
  for (const a of annexR.data || []) {
    if (!annexByBill.has(a.bill_id)) annexByBill.set(a.bill_id, [])
    annexByBill.get(a.bill_id).push(a)
  }
  const billRows = bills.map((b) => {
    const mine = payments.filter((p) => p.bill_id === b.id)
    const paid = mine.reduce((s, p) => s + paidOf(p), 0)
    const waived = mine.reduce((s, p) => s + waiverOf(p), 0)
    const total = b.status === 'void' || b.status === 'applied' ? 0 : Number(b.grand_total || 0)
    // Return credit adjusted against this bill counts as paid on it.
    const credited = slips.filter((r) => r.adjusted_bill_id === b.id && r.credit_status === 'settled').reduce((sum, r) => sum + creditOf(r), 0)
    return {
      ...b,
      paid, waived, credited,
      owed: total - paid - waived - credited,
      gst: gstByBill.get(b.id)?.status || null,
      documents: annexByBill.get(b.id) || [],
    }
  })

  const documents = (annexR.data || []).map((a) => ({ ...a, billNumber: billById.get(a.bill_id)?.internal_bill_number || '' }))

  const purchases = (purchasesR.data || []).map((p) => ({
    ...p,
    billNumber: billById.get(p.reference_id)?.internal_bill_number || '',
    value: Number(p.total_cost || 0),
  }))

  // Stock on hand that came from this vendor, by item across every location it sits in.
  const stockByItem = new Map()
  for (const s of stockR.data || []) {
    const cur = stockByItem.get(s.item_id) || { name: s.inventory_items?.name, unit: s.inventory_items?.units?.code, quantity: 0, value: 0, locations: [] }
    cur.quantity += Number(s.quantity)
    cur.value += Number(s.quantity) * Number(s.avg_unit_cost)
    cur.locations.push({ name: s.inventory_locations?.design_projects?.name || s.inventory_locations?.name, quantity: Number(s.quantity) })
    stockByItem.set(s.item_id, cur)
  }

  const returns = slips.map((r) => ({
    ...r,
    credit: creditOf(r),
    items: (slipItemsR.data || []).filter((i) => i.slip_id === r.id),
  }))

  return {
    supplier: supplierR.data,
    totals: { billed: totalBilled, paid: totalPaid, waived: totalWaived, returned: totalReturned, refunded, creditPending, balance },
    bills: billRows,
    documents,
    gstOpen: (gstR.data || []).filter((g) => g.status !== 'closed').length,
    purchases,
    stock: [...stockByItem.values()].sort((a, b) => b.value - a.value),
    returns,
    ledger,
  }
}
