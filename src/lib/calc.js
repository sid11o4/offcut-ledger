// Client-side mirror of the calculation engine (see supabase/migrations/0012 + 0023) used
// ONLY to show a live preview to the user before they submit a Daily Log entry. The database
// RPC (record_job_work_entry) is the sole source of truth for what actually gets stored/billed
// -- this never writes anything, it just previews the same math using already-fetched lookups.

export function expandServiceComponents(service, allServices, allComponents) {
  if (!service) return []
  if (!service.is_composite) {
    return [{ componentService: service, multiplier: 1 }]
  }
  return allComponents
    .filter((c) => c.service_id === service.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      componentService: allServices.find((s) => s.id === c.component_service_id),
      multiplier: Number(c.multiplier),
    }))
    .filter((c) => c.componentService)
}

// Rates are keyed by (service, rate_category, unit, effective date) since migration 0023.
export function findEffectiveRate(rates, serviceId, rateCategoryId, unitId, asOfDate) {
  const row = rates.find(
    (r) =>
      r.job_work_service_id === serviceId &&
      r.rate_category_id === rateCategoryId &&
      r.unit_id === unitId &&
      r.effective_from <= asOfDate &&
      (!r.effective_to || r.effective_to >= asOfDate),
  )
  return row ? Number(row.rate) : null
}

// Units in which a service can currently be logged for a given rate category + date: the units
// that have an effective rate for every atomic component (for an atomic service, just itself).
// Always includes the service's own default unit as a fallback option.
export function availableUnitsForService(service, rateCategoryId, asOfDate, allServices, allComponents, allRates, allUnits) {
  if (!service) return []
  const components = expandServiceComponents(service, allServices, allComponents)
  const unitIds = new Set()
  for (const u of allUnits) {
    if (!u.active) continue
    const everyComponentHasRate = components.every(
      ({ componentService }) => findEffectiveRate(allRates, componentService.id, rateCategoryId, u.id, asOfDate) !== null,
    )
    if (everyComponentHasRate) unitIds.add(u.id)
  }
  unitIds.add(service.unit_id) // default is always offered even before a rate exists
  return allUnits.filter((u) => unitIds.has(u.id))
}

// Per-unit blended rate for ANY service (atomic or composite) -- used by the Estimates
// line-item editor, where a single service needs one number.
export function serviceUnitRate(service, rateCategoryId, unitId, asOfDate, allServices, allComponents, allRates) {
  const components = expandServiceComponents(service, allServices, allComponents)
  let total = 0
  for (const { componentService, multiplier } of components) {
    const rate = findEffectiveRate(allRates, componentService.id, rateCategoryId, unitId, asOfDate)
    if (rate === null) return null
    total += rate * multiplier
  }
  return total
}

export function previewEntry({ service, baseQuantity, rateCategoryId, unitId, asOfDate, allServices, allComponents, allRates }) {
  const qty = Number(baseQuantity)
  if (!service || !qty || qty <= 0 || !rateCategoryId || !unitId || !asOfDate) {
    return { lines: [], total: 0, missingRates: [] }
  }
  const components = expandServiceComponents(service, allServices, allComponents)
  const missingRates = []
  const lines = components.map(({ componentService, multiplier }) => {
    const componentQuantity = qty * multiplier
    const rate = findEffectiveRate(allRates, componentService.id, rateCategoryId, unitId, asOfDate)
    if (rate === null) missingRates.push(componentService.name)
    const amount = rate === null ? 0 : Math.round(componentQuantity * rate * 100) / 100
    return { service: componentService, multiplier, componentQuantity, rate, amount }
  })
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100
  return { lines, total, missingRates }
}
