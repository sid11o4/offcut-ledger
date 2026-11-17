import { supabase } from './supabaseClient'
import { groupCosts } from './costGroups'

// A project's spent money: every cost charged to it (labour, materials consumed, factory job work, transport,
// miscellaneous) plus the stock it holds (money put into material that is not used yet). One definition for
// every project page and report.
export async function loadProjectSpend() {
  const { data, error } = await supabase.rpc('design_project_spend')
  if (error) throw error
  const byProject = new Map()
  for (const r of data || []) {
    byProject.set(r.design_project_id, {
      labour: Number(r.labour), materials: Number(r.materials), factory: Number(r.factory), other: Number(r.other), inventory: Number(r.inventory), spent: Number(r.spent),
    })
  }
  return byProject
}

// The same figure for a chosen period: the period's costs, with the stock held now.
export function spendFromCostRows(costRows, inventoryValue) {
  const { groups } = groupCosts(costRows)
  const labour = groups.find((g) => g.name === 'Labour')?.total || 0
  const materials = groups.find((g) => g.name === 'Materials')?.total || 0
  const factory = groups.find((g) => g.name === 'Factory Job Work')?.total || 0
  const other = groups.filter((g) => !['Labour', 'Materials', 'Factory Job Work'].includes(g.name)).reduce((t, g) => t + g.total, 0)
  const inventory = Number(inventoryValue || 0)
  return { labour, materials, factory, other, inventory, spent: labour + materials + factory + other + inventory }
}
