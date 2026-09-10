import { describe, it, expect } from 'vitest'
import { previewEntry, findEffectiveRate, serviceUnitRate, availableUnitsForService, expandServiceComponents } from '../calc'

// Fixtures mirror the real schema shape (job_work_services / job_work_components / rates)
// using the spec's scenario: Double Side Cutting = 1x Cutting + 2x Pasting, plus the
// "5.00 until 30-09, 5.50 from 01-10" rate-history example (dates shifted: 4.75 until
// 31-08-2026, 5.50 from 01-09-2026). Rates are keyed by (service, category, UNIT, date)
// since migration 0023.

const SQFT = 'u-sqft'
const RFT = 'u-rft'
const allUnits = [
  { id: SQFT, name: 'Sq.ft', active: true },
  { id: RFT, name: 'R.ft', active: true },
]

const cutting = { id: 'cutting', name: 'Cutting', is_composite: false, unit_id: SQFT }
const pasting = { id: 'pasting', name: 'Pasting', is_composite: false, unit_id: SQFT }
const edgeband = { id: 'edge08', name: 'Edgebanding 0.8mm', is_composite: false, unit_id: RFT }
const singleSideCutting = { id: 'ss_cut', name: 'Single Side Cutting', is_composite: true, unit_id: SQFT }
const doubleSideCutting = { id: 'ds_cut', name: 'Double Side Cutting', is_composite: true, unit_id: SQFT }
const doublePasting = { id: 'double_paste', name: 'Double Pasting', is_composite: true, unit_id: SQFT }

const allServices = [cutting, pasting, edgeband, singleSideCutting, doubleSideCutting, doublePasting]

const allComponents = [
  { service_id: 'ss_cut', component_service_id: 'cutting', multiplier: 1, sort_order: 1 },
  { service_id: 'ss_cut', component_service_id: 'pasting', multiplier: 1, sort_order: 2 },
  { service_id: 'ds_cut', component_service_id: 'cutting', multiplier: 1, sort_order: 1 },
  { service_id: 'ds_cut', component_service_id: 'pasting', multiplier: 2, sort_order: 2 },
  { service_id: 'double_paste', component_service_id: 'pasting', multiplier: 2, sort_order: 1 },
]

// All rates below are in Sq.ft. Cutting/Regular has two effective-dated versions.
const allRates = [
  { job_work_service_id: 'cutting', rate_category_id: 'regular', unit_id: SQFT, rate: 4.75, effective_from: '2026-01-01', effective_to: '2026-08-31' },
  { job_work_service_id: 'cutting', rate_category_id: 'regular', unit_id: SQFT, rate: 5.50, effective_from: '2026-09-01', effective_to: null },
  { job_work_service_id: 'cutting', rate_category_id: 'internal', unit_id: SQFT, rate: 4.00, effective_from: '2026-01-01', effective_to: null },
  { job_work_service_id: 'pasting', rate_category_id: 'regular', unit_id: SQFT, rate: 4.00, effective_from: '2026-01-01', effective_to: null },
  { job_work_service_id: 'pasting', rate_category_id: 'internal', unit_id: SQFT, rate: 3.00, effective_from: '2026-01-01', effective_to: null },
]

describe('rate calculation (atomic service)', () => {
  it('is quantity x rate', () => {
    const result = previewEntry({
      service: cutting, baseQuantity: 1000, rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01',
      allServices, allComponents, allRates,
    })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].rate).toBe(4.00)
    expect(result.lines[0].componentQuantity).toBe(1000)
    expect(result.total).toBe(4000)
  })
})

describe('combination calculation (composite service)', () => {
  it('Double Side Cutting = 1x Cutting + 2x Pasting, summed', () => {
    const result = previewEntry({
      service: doubleSideCutting, baseQuantity: 1000, rateCategoryId: 'regular', unitId: SQFT, asOfDate: '2026-06-01',
      allServices, allComponents, allRates,
    })
    expect(result.lines).toHaveLength(2)
    const cuttingLine = result.lines.find((l) => l.service.id === 'cutting')
    const pastingLine = result.lines.find((l) => l.service.id === 'pasting')
    expect(cuttingLine.componentQuantity).toBe(1000)
    expect(cuttingLine.rate).toBe(4.75)
    expect(cuttingLine.amount).toBe(4750)
    expect(pastingLine.componentQuantity).toBe(2000)
    expect(pastingLine.rate).toBe(4.00)
    expect(pastingLine.amount).toBe(8000)
    expect(result.total).toBe(12750)
  })

  it('a 1x-multiplier composite (Single Side Cutting) matches summing its parts directly', () => {
    const result = previewEntry({
      service: singleSideCutting, baseQuantity: 500, rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01',
      allServices, allComponents, allRates,
    })
    expect(result.total).toBe(3500)
  })

  it('an atomic service expands to a single self-component with multiplier 1', () => {
    const parts = expandServiceComponents(cutting, allServices, allComponents)
    expect(parts).toEqual([{ componentService: cutting, multiplier: 1 }])
  })
})

describe('rate category variance', () => {
  it('the same job-work produces different revenue for different rate categories', () => {
    const internal = previewEntry({ service: cutting, baseQuantity: 100, rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates })
    const regular = previewEntry({ service: cutting, baseQuantity: 100, rateCategoryId: 'regular', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates })
    expect(internal.total).toBe(400)
    expect(regular.total).toBe(475)
    expect(internal.total).not.toBe(regular.total)
  })
})

describe('rate history', () => {
  it('a job dated before the rate revision uses the old rate even though a newer one now exists', () => {
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2026-08-31')).toBe(4.75)
  })

  it('a job dated on/after the revision date uses the new rate', () => {
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2026-09-01')).toBe(5.50)
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2027-01-01')).toBe(5.50)
  })

  it('changing the rate today does not alter what a historical date resolves to', () => {
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2026-08-15')).toBe(4.75)
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2026-09-15')).toBe(5.50)
  })

  it('returns null before any rate existed', () => {
    expect(findEffectiveRate(allRates, 'cutting', 'regular', SQFT, '2025-12-31')).toBeNull()
  })

  it('a composite service blends the correct historical rate per component', () => {
    const before = previewEntry({ service: doubleSideCutting, baseQuantity: 100, rateCategoryId: 'regular', unitId: SQFT, asOfDate: '2026-08-31', allServices, allComponents, allRates })
    const after = previewEntry({ service: doubleSideCutting, baseQuantity: 100, rateCategoryId: 'regular', unitId: SQFT, asOfDate: '2026-09-01', allServices, allComponents, allRates })
    expect(before.total).toBe(1275)
    expect(after.total).toBe(1350)
    expect(after.total).toBeGreaterThan(before.total)
  })
})

describe('multi-unit rates', () => {
  const ratesWithRft = [
    ...allRates,
    { job_work_service_id: 'cutting', rate_category_id: 'internal', unit_id: RFT, rate: 9.00, effective_from: '2026-01-01', effective_to: null },
  ]

  it('the same service resolves to a different rate depending on the unit chosen', () => {
    expect(findEffectiveRate(ratesWithRft, 'cutting', 'internal', SQFT, '2026-06-01')).toBe(4.00)
    expect(findEffectiveRate(ratesWithRft, 'cutting', 'internal', RFT, '2026-06-01')).toBe(9.00)
  })

  it('previewEntry prices in the selected unit', () => {
    const sqft = previewEntry({ service: cutting, baseQuantity: 10, rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates: ratesWithRft })
    const rft = previewEntry({ service: cutting, baseQuantity: 10, rateCategoryId: 'internal', unitId: RFT, asOfDate: '2026-06-01', allServices, allComponents, allRates: ratesWithRft })
    expect(sqft.total).toBe(40)
    expect(rft.total).toBe(90)
  })

  it('availableUnitsForService lists only units where every component has a rate (plus the default)', () => {
    // Cutting has a rate in both units; its default is Sq.ft.
    const forCutting = availableUnitsForService(cutting, 'internal', '2026-06-01', allServices, allComponents, ratesWithRft, allUnits)
    expect(forCutting.map((u) => u.id).sort()).toEqual([RFT, SQFT].sort())

    // Double Side Cutting needs Cutting AND Pasting to have a rate in a unit. Pasting only has
    // a Sq.ft rate, so only Sq.ft is offered even though Cutting also has an R.ft rate.
    const forComposite = availableUnitsForService(doubleSideCutting, 'internal', '2026-06-01', allServices, allComponents, ratesWithRft, allUnits)
    expect(forComposite.map((u) => u.id)).toEqual([SQFT])
  })
})

describe('missing rate handling', () => {
  it('flags a component with no configured rate instead of silently pricing it as zero', () => {
    const result = previewEntry({
      service: edgeband, baseQuantity: 50, rateCategoryId: 'regular', unitId: RFT, asOfDate: '2026-06-01',
      allServices, allComponents, allRates,
    })
    expect(result.missingRates).toContain('Edgebanding 0.8mm')
    expect(result.lines[0].rate).toBeNull()
    expect(result.lines[0].amount).toBe(0)
  })

  it('serviceUnitRate returns null (not a wrong number) when any component lacks a rate', () => {
    expect(serviceUnitRate(edgeband, 'regular', RFT, '2026-06-01', allServices, allComponents, allRates)).toBeNull()
  })
})

describe('serviceUnitRate (per-unit blended rate for estimates)', () => {
  it('matches the per-unit total of the equivalent Daily Log preview', () => {
    const perUnit = serviceUnitRate(doubleSideCutting, 'regular', SQFT, '2026-06-01', allServices, allComponents, allRates)
    const preview = previewEntry({ service: doubleSideCutting, baseQuantity: 1, rateCategoryId: 'regular', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates })
    expect(perUnit).toBe(preview.total)
    expect(perUnit).toBe(4.75 + 2 * 4.00)
  })
})

describe('edge cases', () => {
  it('returns an empty preview for zero/blank quantity rather than throwing', () => {
    const result = previewEntry({ service: cutting, baseQuantity: '', rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates })
    expect(result.lines).toEqual([])
    expect(result.total).toBe(0)
  })

  it('returns an empty preview when no service is selected yet', () => {
    const result = previewEntry({ service: null, baseQuantity: 10, rateCategoryId: 'internal', unitId: SQFT, asOfDate: '2026-06-01', allServices, allComponents, allRates })
    expect(result.lines).toEqual([])
  })
})
