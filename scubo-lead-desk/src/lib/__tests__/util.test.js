import { describe, expect, it } from 'vitest'
import { addDays, diffDays, dueCls, filterLeads, fmtBudget, fmtPhone, followLabel, metaCsvToLeads, normPhone, parseCsv, toCsv, waLink } from '../util'

describe('phone', () => {
  it('keeps the last 10 digits', () => {
    expect(normPhone('+91 98765-43210')).toBe('9876543210')
    expect(normPhone('p:+919876543210')).toBe('9876543210')
    expect(normPhone('98765')).toBe('98765')
  })
  it('formats and links', () => {
    expect(fmtPhone('9876543210')).toBe('+91 98765 43210')
    expect(waLink('9876543210')).toBe('https://wa.me/919876543210')
    expect(waLink('123')).toBeNull()
  })
})

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('labels follow-ups relative to a day', () => {
    const from = '2026-09-23'
    expect(diffDays('2026-09-20', from)).toBe(-3)
    expect(followLabel('2026-09-23', from)).toBe('Today')
    expect(followLabel('2026-09-24', from)).toBe('Tomorrow')
    expect(followLabel('2026-09-22', from)).toBe('Yesterday')
    expect(followLabel('2026-09-20', from)).toBe('3 days overdue')
    expect(dueCls('2026-09-20', 'New', from)).toBe('over')
    expect(dueCls('2026-09-20', 'Booked', from)).toBe('')
    expect(dueCls('2026-09-23', 'Interested', from)).toBe('today')
  })
})

describe('budget', () => {
  it('shows lakhs and crores', () => {
    expect(fmtBudget(85)).toBe('₹85 L')
    expect(fmtBudget(150)).toBe('₹1.5 Cr')
    expect(fmtBudget(null)).toBe('')
  })
})

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [['a', 'b,c', 'say "hi"', 'x\ny']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
  it('neutralises formula injection', () => {
    expect(toCsv([['=HYPERLINK("x")']])).toBe('"\'=HYPERLINK(""x"")"')
  })
  it('parses tab-separated Meta exports', () => {
    const text = 'id\tcreated_time\tcampaign_name\tplatform\tfull_name\tphone_number\tcity\nl:777\t2026-09-01T10:00:00+0530\tDiwali\tig\tRavi K\tp:+919876543210\tKarur\nl:778\t2026-09-01\tDiwali\tfb\tNo Phone\t\tKarur\n'
    const { rows, blank } = metaCsvToLeads(text)
    expect(blank).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Ravi K', phone: '9876543210', area: 'Karur', note: 'Imported from Meta · Diwali', meta_lead_id: '777', campaign_name: 'Diwali', platform: 'ig' })
    expect(rows[0].created_at).toMatch(/^2026-09-01T04:30/)
  })
  it('rejects files without a phone column', () => {
    expect(metaCsvToLeads('name,email\nA,a@b.c').error).toMatch(/phone column/)
  })
})

describe('filterLeads', () => {
  const leads = [
    { id: '1', name: 'Ravi', phone: '9876543210', area: 'Karur', requirement: '3 BHK', email: '', stage: 'New', project_id: 'p1', budget_lakhs: 80, created_at: '2026-09-01' },
    { id: '2', name: 'Anu', phone: '9000000001', area: 'Trichy', requirement: '2 BHK', email: '', stage: 'Booked', project_id: 'p2', budget_lakhs: 120, created_at: '2026-09-02' },
  ]
  const pn = (id) => ({ p1: 'Skyville', p2: 'Lakeview' })[id] || ''
  const base = { q: '', stage: '', project: '', source: '', assigned: '', priority: '', sort: 'new' }
  it('searches by phone digits and project name', () => {
    expect(filterLeads(leads, { ...base, q: '43210' }, pn).map((l) => l.id)).toEqual(['1'])
    expect(filterLeads(leads, { ...base, q: 'lakeview' }, pn).map((l) => l.id)).toEqual(['2'])
  })
  it('sorts by budget', () => {
    expect(filterLeads(leads, { ...base, sort: 'budget' }, pn).map((l) => l.id)).toEqual(['2', '1'])
  })
})
