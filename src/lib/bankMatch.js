import { supabase } from './supabaseClient'

// AI matching of bank debits to pending RTGS/NEFT payments: UTR, then the payee name read by
// Claude, then (only when no payee can be identified) the amount at 95% or better.
export async function matchBankPayments() {
  // Payments already confirmed by hand are linked to their statement line by UTR first, so those lines are not
  // matched to a different payment by name or amount.
  let linked = 0
  const link = await supabase.rpc('link_statement_to_confirmed_payments')
  if (!link.error) linked = Number(link.data || 0)
  const result = await matchPending()
  return { ...result, by_manual: linked }
}

async function matchPending() {
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
  const manual = r.by_manual ? `${r.by_manual} payment${r.by_manual === 1 ? '' : 's'} already marked paid linked to the statement by UTR. ` : ''
  if (r.by_utr) parts.push(`${r.by_utr} by UTR`)
  if (r.by_name) parts.push(`${r.by_name} by payee name`)
  if (r.by_amount) parts.push(`${r.by_amount} by amount (no payee name found)`)
  let s = manual + (total ? `${total} payment${total === 1 ? '' : 's'} matched (${parts.join(', ')}).` : 'No new payments matched the uploaded statements.')
  if (r.review) s += ` ${r.review} name match${r.review === 1 ? '' : 'es'} with a different amount left for review.`
  if (r.note) s += ` ${r.note}`
  return s
}
