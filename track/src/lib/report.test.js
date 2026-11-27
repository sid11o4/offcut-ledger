import { describe, it, expect } from 'vitest'
import { buildReport, dayNumberOf, taskPhrase, points } from './report'

const panel = { name: 'Panelling', weight: 1, hasPolish: false, tasks: [{ name: 'Raw board', points: 50 }, { name: 'Lamination', points: 50 }] }
const plan = {
  rooms: [{ id: 'r1', name: 'Living' }, { id: 'r2', name: 'Kitchen' }, { id: 'r3', name: 'Store' }],
  items: [
    { id: 'a', roomId: 'r1', title: 'TV panel ', sqft: 10, polish: 'No', cat: panel, progress: [100, 50] },
    { id: 'b', roomId: 'r2', title: 'Base unit', sqft: 10, polish: 'No', cat: panel, progress: [0, 0] },
  ],
}
const project = { name: 'B2', client_name: 'Client', location: 'Karur' }

describe('buildReport', () => {
  it('reports only what moved, grouped by room, from the start snapshot', () => {
    const r = buildReport({ project, plan, report: { report_date: '2026-11-21', start_state: { a: [50, 0], b: [0, 0] }, start_pct: 0.9 } })
    expect(r.hasSnapshot).toBe(true)
    expect(r.work).toHaveLength(1)
    expect(r.work[0].room).toBe('Living')
    expect(r.work[0].items[0].title).toBe('TV panel')
    expect(r.work[0].items[0].tasks).toEqual([{ name: 'Raw board', from: 50, to: 100 }, { name: 'Lamination', from: 0, to: 50 }])
    expect(r.tasksMoved).toBe(2)
    expect(r.tasksCompleted).toBe(1)
    // Recomputed from snapshots, not the stored start_pct: 12.5% -> 37.5% overall.
    expect(r.overall.start).toBeCloseTo(0.125)
    expect(r.overall.end).toBeCloseTo(0.375)
    expect(r.overall.moved).toBeCloseTo(0.25)
    expect(r.roomsMoved).toBe(1)
    expect(r.rooms.find((x) => x.id === 'r3').items).toBe(0)
  })

  it('reads zero movement when nothing changed', () => {
    const r = buildReport({ project, plan, report: { report_date: '2026-11-21', start_state: { a: [100, 50], b: [0, 0] }, start_pct: 0.7 } })
    expect(r.overall.moved).toBe(0)
    expect(r.work).toEqual([])
  })

  it('uses the saved end state for a closed day', () => {
    const report = { report_date: '2026-11-20', closed_at: '2026-11-20T18:00:00Z', start_state: { a: [0, 0], b: [0, 0] }, end_state: { a: [50, 0], b: [0, 0] } }
    const r = buildReport({ project, plan, report })
    expect(r.work[0].items[0].tasks).toEqual([{ name: 'Raw board', from: 0, to: 50 }])
  })

  it('says nothing about movement for days imported without snapshots', () => {
    const report = { report_date: '2026-09-22', closed_at: '2026-09-23T00:00:00Z', start_state: {}, start_pct: 0, end_pct: null, next_day_plan: ' Fix shutters ' }
    const r = buildReport({ project, plan, report })
    expect(r.hasSnapshot).toBe(false)
    expect(r.work).toEqual([])
    expect(r.rooms).toEqual([])
    expect(r.overall).toEqual({ start: null, end: null, moved: null })
    expect(r.nextPlan).toBe('Fix shutters')
  })

  it('totals labour and keeps only open material requests', () => {
    const report = { report_date: 'x', start_state: { a: [100, 50] }, labour: [{ trade: 'Carpenter', count: 3, shifts: 1.5 }, { trade: 'Helper', count: 2, shifts: '' }, { trade: '', count: '' }] }
    const requests = [{ status: 'requested' }, { status: 'approved' }, { status: 'fulfilled' }, { status: 'cancelled' }]
    const r = buildReport({ project, plan, report, requests })
    expect(r.labour).toHaveLength(2)
    expect(r.headcount).toBe(5)
    expect(r.manShifts).toBe(6.5)
    expect(r.openRequests).toHaveLength(2)
  })
})

describe('report helpers', () => {
  it('numbers site days', () => {
    const h = [{ report_date: '2026-09-22' }, { report_date: '2026-09-25' }, { report_date: '2026-09-23' }]
    expect(dayNumberOf(h, '2026-09-25')).toBe(3)
    expect(dayNumberOf(h, '2026-11-21')).toBe(4)
  })
  it('phrases task changes for clients', () => {
    expect(taskPhrase({ from: 50, to: 100 })).toBe('Completed')
    expect(taskPhrase({ from: 0, to: 25 })).toBe('Started · 25%')
    expect(taskPhrase({ from: 25, to: 75 })).toBe('25% → 75%')
    expect(taskPhrase({ from: 75, to: 50 })).toBe('Revised to 50%')
    expect(points(0.0125)).toBe('+1.3')
    expect(points(-0.003)).toBe('−0.3')
    expect(points(0)).toBe('0.0')
  })
})
