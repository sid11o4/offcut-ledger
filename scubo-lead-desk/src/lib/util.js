// Pure helpers: constants, phone/date/money formatting, CSV. No Supabase or DOM here,
// so everything in this file is unit-tested in __tests__/util.test.js.

export const STAGES = ['New', 'Contacted', 'Interested', 'Site Visit Scheduled', 'Site Visit Done', 'Negotiation', 'Booked', 'Not Qualified']
export const STAGE_CLS = {
  'New': 's-new', 'Contacted': 's-contacted', 'Interested': 's-interested', 'Site Visit Scheduled': 's-svs',
  'Site Visit Done': 's-svd', 'Negotiation': 's-neg', 'Booked': 's-booked', 'Not Qualified': 's-lost',
}
export const SOURCES = ['Meta – Lead form', 'Meta – WhatsApp', 'Walk-in', 'Referral', 'Phone call', 'Website', 'Other']
export const PRIORITIES = ['Hot', 'Warm', 'Cold']
export const CLOSED = new Set(['Booked', 'Not Qualified'])
export const LOG_CHIPS = ['Called – no answer', 'Called – spoke', 'WhatsApp sent', 'Brochure sent', 'Site visit done']

// ---- phone (Indian mobile numbers, stored as the last 10 digits) ----
export const normPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}
export const fmtPhone = (p) => {
  const d = normPhone(p)
  return d.length === 10 ? '+91 ' + d.slice(0, 5) + ' ' + d.slice(5) : (p || '')
}
export const waLink = (p) => {
  const d = normPhone(p)
  return d.length === 10 ? 'https://wa.me/91' + d : null
}

// ---- dates: plain YYYY-MM-DD strings in the viewer's local time ----
export const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
export const today = () => ymd(new Date())
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s, n) => {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const diffDays = (s, from = today()) => (s ? Math.round((parseYmd(s) - parseYmd(from)) / 86400000) : null)
export const fmtDate = (s) => (s ? parseYmd(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')
export const fmtWhen = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
export const isoToYmd = (iso) => (iso ? ymd(new Date(iso)) : '')

export function followLabel(s, from = today()) {
  const n = diffDays(s, from)
  if (n === null) return ''
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return -n + ' days overdue'
  return fmtDate(s)
}
export function dueCls(s, stage, from = today()) {
  if (!s || CLOSED.has(stage)) return ''
  const n = diffDays(s, from)
  return n < 0 ? 'over' : n === 0 ? 'today' : ''
}

// Budget is stored in lakhs; 100 L = 1 Cr.
export const fmtBudget = (v) => {
  v = Number(v)
  if (!v) return ''
  if (v >= 100) return '₹' + Math.round(v) / 100 + ' Cr'
  return '₹' + v + ' L'
}

// ---- CSV ----
export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    v = String(v ?? '')
    // Neutralise spreadsheet formula injection from lead-supplied text.
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
  }).join(',')).join('\r\n')
}

export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  text = text.replace(/^\ufeff/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

// Turn a Meta Leads Center / Ads Manager export into rows for leaddesk.import_leads().
// Returns { rows, error, blank } where blank counts rows without a usable phone.
export function metaCsvToLeads(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { error: 'No rows found in that file.' }
  const h = rows[0].map((x) => x.trim().toLowerCase())
  // Exact header names win over partial matches (so 'campaign_name' is never taken as 'name').
  const find = (...keys) => {
    for (const k of keys) { const i = h.indexOf(k); if (i >= 0) return i }
    return h.findIndex((x) => keys.some((k) => x.includes(k)) && !/campaign|form_|ad_|adset/.test(x))
  }
  const iName = find('full_name', 'full name', 'name')
  const iPhone = find('phone_number', 'phone', 'mobile', 'whatsapp')
  const iEmail = find('email')
  const iCity = find('city', 'location', 'area')
  const iCamp = h.findIndex((x) => ['campaign_name', 'form_name', 'ad_name'].includes(x))
  const iDate = find('created_time', 'date')
  if (iPhone < 0) return { error: 'Could not find a phone column. The first row should have headers like full_name, phone_number.' }
  const out = []
  let blank = 0
  for (const r of rows.slice(1)) {
    const phone = normPhone((r[iPhone] || '').replace(/^p:/, ''))
    if (phone.length !== 10) { blank++; continue }
    const rawDate = iDate >= 0 ? r[iDate] : ''
    const when = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null
    out.push({
      name: (iName >= 0 ? r[iName] : '').trim(),
      phone,
      email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
      area: iCity >= 0 ? (r[iCity] || '').trim() : '',
      created_at: when,
      note: iCamp >= 0 && r[iCamp] ? `Imported from Meta · ${r[iCamp].trim()}` : 'Imported from Meta CSV',
    })
  }
  return { rows: out, blank }
}

// Meta exports are sometimes UTF-16 with tabs.
export async function readCsvFile(file) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || bytes.slice(0, 200).includes(0)
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(buf)
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- filtering / sorting for the All leads view ----
export function filterLeads(leads, f, projectName) {
  const q = f.q.trim().toLowerCase()
  const qd = q.replace(/\D/g, '')
  const a = leads.filter((l) => {
    if (f.stage && l.stage !== f.stage) return false
    if (f.project && l.project_id !== f.project) return false
    if (f.source && l.source !== f.source) return false
    if (f.assigned && l.assigned_to !== f.assigned) return false
    if (f.priority && l.priority !== f.priority) return false
    if (q) {
      const hay = [l.name, l.area, l.requirement, l.email, projectName(l.project_id)].join(' ').toLowerCase()
      if (!hay.includes(q) && !(qd.length >= 3 && l.phone.includes(qd))) return false
    }
    return true
  })
  const by = {
    new: (x, y) => (y.created_at || '').localeCompare(x.created_at || ''),
    updated: (x, y) => (y.updated_at || '').localeCompare(x.updated_at || ''),
    follow: (x, y) => (x.next_follow_up || '9999').localeCompare(y.next_follow_up || '9999'),
    budget: (x, y) => (Number(y.budget_lakhs) || 0) - (Number(x.budget_lakhs) || 0),
    name: (x, y) => (x.name || '').localeCompare(y.name || ''),
  }
  return a.sort(by[f.sort] || by.new)
}
