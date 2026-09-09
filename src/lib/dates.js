import { formatInTimeZone } from 'date-fns-tz'

// All entry_date / expense_date columns are plain SQL `date` (no time component, no timezone
// concern by construction). The one place timezone actually matters is deciding what "today"
// is, and displaying timestamptz audit fields -- both anchored to the factory's local zone so
// a late-night entry never silently lands under the wrong day (spec section 51).
export const APP_TIMEZONE = import.meta.env.VITE_APP_TIMEZONE || 'Asia/Kolkata'

export function today() {
  return formatInTimeZone(new Date(), APP_TIMEZONE, 'yyyy-MM-dd')
}

export function isoDaysAgo(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return formatInTimeZone(d, APP_TIMEZONE, 'yyyy-MM-dd')
}

export function startOfThisMonth() {
  return today().slice(0, 8) + '01'
}

export function startOfLastMonth() {
  const [y, m] = today().split('-').map(Number)
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y
  return `${prevY}-${String(prevM).padStart(2, '0')}-01`
}

export function endOfLastMonth() {
  const [y, m] = today().split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y
  return `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export function startOfYear() {
  return today().slice(0, 4) + '-01-01'
}

export function startOfWeek(dateStr = today()) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? 6 : day - 1) // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

export function displayDate(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[Number(m) - 1]} ${y}`
}

export function displayDateTime(ts) {
  if (!ts) return '—'
  return formatInTimeZone(new Date(ts), APP_TIMEZONE, 'dd MMM yyyy, hh:mm a')
}
