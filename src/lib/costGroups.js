import { supabase } from './supabaseClient'

// Design Build costs are reported in these groups everywhere: Labour; Materials, split into Raw Board,
// Edgeband, Skin, Adhesives, Hardware and Others; Factory Job Work; Transport; Miscellaneous.
export const COST_GROUPS = ['Labour', 'Materials', 'Factory Job Work', 'Transport', 'Miscellaneous']
export const MATERIAL_SUBS = ['Raw Board', 'Edgeband', 'Skin', 'Adhesives', 'Hardware', 'Others']

// rows: [{ grp, subgrp, amount, design_project_id?, project_name? }] from design_build_cost_breakdown().
// Returns every group in order, with materials split into their sub-groups, and the grand total.
export function groupCosts(rows) {
  const out = COST_GROUPS.map((name) => ({
    name, total: 0, places: new Map(),
    subs: name === 'Materials' ? MATERIAL_SUBS.map((n) => ({ name: n, amount: 0 })) : null,
  }))
  const byName = new Map(out.map((g) => [g.name, g]))
  for (const r of rows || []) {
    const g = byName.get(r.grp)
    if (!g) continue
    const amount = Number(r.amount)
    g.total += amount
    const place = r.project_name || 'Company'
    g.places.set(place, (g.places.get(place) || 0) + amount)
    if (g.subs) {
      const sub = g.subs.find((s) => s.name === r.subgrp) || g.subs[g.subs.length - 1]
      sub.amount += amount
    }
  }
  return { groups: out, grand: out.reduce((s, g) => s + g.total, 0) }
}

// A flat list, for tables and PDFs that take rows of { name, amount }: "Materials — Raw Board" under Materials.
export function flatCosts(rows) {
  const { groups } = groupCosts(rows)
  const flat = []
  for (const g of groups) {
    flat.push({ name: g.name, amount: g.total, level: 0 })
    if (g.subs) for (const s of g.subs) flat.push({ name: s.name, amount: s.amount, level: 1 })
  }
  return flat
}

export async function loadCostBreakdown({ projectId = null, start = null, end = null } = {}) {
  const { data, error } = await supabase.rpc('design_build_cost_breakdown', { p_project: projectId, p_start: start, p_end: end })
  if (error) throw error
  return data || []
}
