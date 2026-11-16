import { supabase } from './supabaseClient'

// Payables and receivables per Design Build project, and their totals.
export async function loadPayReceive() {
  const { data, error } = await supabase.rpc('design_build_payables_receivables')
  if (error) throw error
  const byProject = new Map()
  const totals = { vendorPayable: 0, labourPayable: 0, payables: 0, contract: 0, received: 0, receivable: 0 }
  for (const r of data || []) {
    const v = {
      vendorPayable: Number(r.vendor_payable),
      labourPayable: Number(r.labour_payable),
      contract: Number(r.contract_total),
      received: Number(r.received_total),
      receivable: Number(r.receivable),
    }
    v.payables = v.vendorPayable + v.labourPayable
    byProject.set(r.design_project_id, v)
    for (const k of Object.keys(totals)) totals[k] += v[k]
  }
  return { byProject, totals }
}
