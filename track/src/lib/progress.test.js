import { describe, it, expect } from 'vitest'
import { activeTasks, itemPct, itemWeight, weighted, statusLabel, localDateKey, dayChanges } from './progress'

const panelling = { weight: 0.5, hasPolish: true, tasks: [{ name: 'Raw board', points: 50 }, { name: 'Lamination', points: 50 }] }
const gypsum = { weight: 0.5, hasPolish: false, tasks: [{ name: 'Channel', points: 40 }, { name: 'Wiring', points: 20 }, { name: 'Board', points: 20 }, { name: 'Painting', points: 20 }] }

describe('progress maths', () => {
  it('adds a polish task worth base/9 only when polished', () => {
    expect(activeTasks(panelling, 'No')).toHaveLength(2)
    const t = activeTasks(panelling, 'Yes')
    expect(t).toHaveLength(3)
    expect(t[2].pts).toBeCloseTo(100 / 9)
    expect(activeTasks(gypsum, 'Yes')).toHaveLength(4)
  })
  it('weights tasks by points', () => {
    expect(itemPct(gypsum, 'No', [100, 0, 0, 0])).toBeCloseTo(0.4)
    expect(itemPct(gypsum, 'No', [100, 100, 100, 100])).toBe(1)
    expect(itemPct(gypsum, 'No', [])).toBe(0)
  })
  it('counts polish in the denominator', () => {
    expect(itemPct(panelling, 'Yes', [100, 100, 0])).toBeCloseTo(100 / (100 + 100 / 9))
  })
  it('weights items by sqft x category weight', () => {
    expect(itemWeight(panelling, 200)).toBe(100)
    const rows = [{ pct: 1, weight: 100 }, { pct: 0, weight: 300 }]
    expect(weighted(rows)).toBeCloseTo(0.25)
    expect(weighted([])).toBe(0)
  })
  it('labels status', () => {
    expect([0, 0.2, 0.5, 0.75, 1].map(statusLabel)).toEqual(['Not started', 'Started', 'Halfway', 'Advanced', 'Complete'])
  })
  it('uses the local calendar day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 1, 0))).toBe('2026-01-05')
  })
  it('reports what changed and what completed since the day started', () => {
    const items = [{ id: 'a', title: 'Wardrobe', cat: gypsum, polish: 'No', progress: [100, 50, 0, 0] }]
    const r = dayChanges(items, { a: [60, 50, 0, 0] })
    expect(r.changed).toEqual([{ itemId: 'a', item: 'Wardrobe', task: 'Channel', from: 60, to: 100 }])
    expect(r.completed).toEqual([{ item: 'Wardrobe', task: 'Channel' }])
  })
})
