import { supabase } from './supabaseClient'

// AI matching of bank debits to pending RTGS/NEFT payments: UTR, then the payee name read by
// Claude, then (only when no payee can be identified) the amount at 95% or better.
export async function matchBankPayments() {
  const { data, error } = await supabase.functions.invoke('match-bank-payments', { body: {} })
  if (error) {
    let msg = error.message
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error } catch { /* keep message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function matchSummary(r) {
  const total = (r.by_utr || 0) + (r.by_name || 0) + (r.by_amount || 0)
  const parts = []
  if (r.by_utr) parts.push(`${r.by_utr} by UTR`)
  if (r.by_name) parts.push(`${r.by_name} by payee name`)
  if (r.by_amount) parts.push(`${r.by_amount} by amount (no payee name found)`)
  let s = total ? `${total} payment${total === 1 ? '' : 's'} matched (${parts.join(', ')}).` : 'No new payments matched the uploaded statements.'
  if (r.review) s += ` ${r.review} name match${r.review === 1 ? '' : 'es'} with a different amount left for review.`
  if (r.note) s += ` ${r.note}`
  return s
}
