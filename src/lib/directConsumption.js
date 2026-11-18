import { supabase } from './supabaseClient'

// Material lines on approved vendor bills that were marked "consumed directly": a cost charged to the
// project (or to the company when it has none) that never went through stock. Every "materials consumed"
// view reads these together with stock consumption and past consumption.
export async function loadDirectConsumption({ projectId = null, start = null, end = null } = {}) {
  const { data, error } = await supabase.from('supplier_bill_items')
    .select('description, quantity, unit_text, total_amount, design_project_id, company_level, design_projects(name), supplier_bills!inner(bill_date, status, design_project_id, supplier_text, suppliers(name), design_projects(name))')
    .eq('consumed_directly', true).eq('item_type', 'material').eq('pays_vendor_credit', false)
    .eq('supplier_bills.status', 'approved')
  if (error) throw error
  return (data || []).map((i) => {
    const b = i.supplier_bills
    const pid = i.company_level ? null : (i.design_project_id || b.design_project_id || null)
    const pname = i.company_level ? null : (i.design_projects?.name || b.design_projects?.name || null)
    return {
      projectId: pid, projectName: pname || 'Company (non-project)',
      item: i.description, unit: i.unit_text || '', quantity: Number(i.quantity), cost: Number(i.total_amount),
      date: b.bill_date, vendor: b.suppliers?.name || b.supplier_text || 'Vendor not recorded',
    }
  }).filter((r) => (!projectId || r.projectId === projectId) && (!start || r.date >= start) && (!end || r.date <= end))
}
