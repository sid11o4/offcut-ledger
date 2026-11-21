import { supabase } from './supabaseClient'

// Material lines on approved vendor bills that were marked "consumed directly", and material lines on
// FORMGRID bills (which never touch stock and carry a cost head): a cost charged to the project (or to
// the company when it has none) that never went through stock. Every "materials consumed"
// view reads these together with stock consumption and past consumption.
export async function loadDirectConsumption({ projectId = null, start = null, end = null } = {}) {
  const { data, error } = await supabase.from('supplier_bill_items')
    .select('description, cost_head, inventory_item_id, consumed_directly, returned_qty, quantity, unit_text, total_amount, design_project_id, company_level, design_projects(name), supplier_bills!inner(bill_date, status, bill_source, design_project_id, supplier_text, suppliers(name), design_projects(name))')
    .eq('item_type', 'material').eq('pays_vendor_credit', false)
    .or('consumed_directly.eq.true,and(inventory_item_id.is.null,cost_head.not.is.null)')
    .eq('supplier_bills.status', 'approved')
  if (error) throw error
  return (data || []).filter((i) => i.consumed_directly || i.supplier_bills.bill_source === 'formgrid').map((i) => {
    const b = i.supplier_bills
    const pid = i.company_level ? null : (i.design_project_id || b.design_project_id || null)
    const pname = i.company_level ? null : (i.design_projects?.name || b.design_projects?.name || null)
    return {
      projectId: pid, projectName: pname || 'Company (non-project)',
      item: i.description, costHead: i.cost_head, unit: i.unit_text || '',
      // what was returned to the vendor is not consumed
      quantity: Number(i.quantity) - Number(i.returned_qty || 0),
      cost: Number(i.total_amount) * (1 - Math.min(Number(i.returned_qty || 0) / (Number(i.quantity) || 1), 1)),
      date: b.bill_date, vendor: b.suppliers?.name || b.supplier_text || 'Vendor not recorded',
    }
  }).filter((r) => (!projectId || r.projectId === projectId) && (!start || r.date >= start) && (!end || r.date <= end))
}
