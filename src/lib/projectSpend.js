import { supabase } from './supabaseClient'
import { groupCosts } from './costGroups'

// A project's spent money: its labour + the materials consumed + the stock it holds (money put into
// material that is not used yet). One definition for every project page and report.
export async function loadProjectSpend() {
  const { data, error } = await supabase.rpc('design_project_spend')
  if (error) throw error
  const byProject = new Map()
  for (const r of data || []) {
    byProject.set(r.design_project_id, {
      labour: Number(r.labour), materials: Number(r.materials), inventory: Number(r.inventory), spent: Number(r.spent),
    })
  }
  return byProject
}

// The same figure for a chosen period: labour and materials from the period's costs, with the stock held now.
export function spendFromCostRows(costRows, inventoryValue) {
  const { groups } = groupCosts(costRows)
  const labour = groups.find((g) => g.name === 'Labour')?.total || 0
  const materials = groups.find((g) => g.name === 'Materials')?.total || 0
  const inventory = Number(inventoryValue || 0)
  return { labour, materials, inventory, spent: labour + materials + inventory }
}
