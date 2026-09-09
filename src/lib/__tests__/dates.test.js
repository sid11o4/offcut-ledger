import { describe, it, expect } from 'vitest'
import { startOfLastMonth, endOfLastMonth, startOfThisMonth, startOfWeek } from '../dates'

// These don't depend on "now" in a fragile way -- they check internal consistency (e.g. that
// last month immediately precedes this month) rather than hard-coding today's date.
describe('date range helpers', () => {
  it('startOfThisMonth is always the 1st', () => {
    expect(startOfThisMonth().endsWith('-01')).toBe(true)
  })

  it('endOfLastMonth is exactly one day before startOfThisMonth', () => {
    const end = new Date(endOfLastMonth() + 'T00:00:00Z')
    const start = new Date(startOfThisMonth() + 'T00:00:00Z')
    const diffDays = (start - end) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBe(1)
  })

  it('startOfLastMonth is always the 1st and precedes endOfLastMonth', () => {
    expect(startOfLastMonth().endsWith('-01')).toBe(true)
    expect(startOfLastMonth() <= endOfLastMonth()).toBe(true)
  })

  it('startOfWeek returns a Monday', () => {
    const d = new Date(startOfWeek('2026-09-08') + 'T00:00:00Z')
    expect(d.getUTCDay()).toBe(1) // 1 = Monday
  })

  it('startOfWeek is idempotent for a date that is already Monday', () => {
    // 2026-09-07 is a Monday
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })
})
