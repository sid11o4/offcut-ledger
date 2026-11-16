// Matches unmatched bank-statement debits to pending RTGS/NEFT payments.
//
// Order of preference, per bank line:
//   1. UTR reference equal to the payment's UTR.
//   2. The payee: Claude Haiku 5.5 reads the statement narration and says which pending payment's
//      vendor/contractor it is paying. A name match is only confirmed when the amounts are also
//      within 95% of each other; otherwise the line is left for a person to review.
//   3. Only when the narration names no payee Claude can identify, the amount alone (95% or better).
// If Claude is unavailable, step 3 is applied to every unmatched line instead.
//
// Requires the ANTHROPIC_API_KEY secret. POST body: {} . Authenticates itself (verify_jwt off).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MODEL = 'claude-haiku-5-5'
const CHUNK = 40
const MAX_LINES = 400

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bank_id: { type: 'string' },
          payee_identified: {
            type: 'boolean',
            description: 'True when the narration names a payee (a person or company being paid), whether or not it is one of the listed vendors. False when the narration has no readable payee name (only codes, bank charges, or generic text).',
          },
          payment_id: {
            type: ['string', 'null'],
            description: 'The id of the listed payment whose vendor is that payee. If the payee has several listed payments, the one whose amount is closest to the debit. Null if the payee is not among the listed vendors.',
          },
        },
        required: ['bank_id', 'payee_identified', 'payment_id'],
      },
    },
  },
  required: ['lines'],
}

// deno-lint-ignore no-explicit-any
async function callAnthropic(apiKey: string, body: unknown): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    if (resp.ok) return resp.json()
    if (![503, 529].includes(resp.status) || attempt === 3) {
      throw new Error(`Anthropic API error (${resp.status}): ${await resp.text()}`)
    }
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }
}

const within95 = (a: number, b: number) => Math.min(a, b) / Math.max(a, b) >= 0.95

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: 'Not signed in.' }, 401)
  const { data: allowed } = await db.rpc('has_permission', { perm_key: 'bank_reconciliation' })
  if (!allowed) return json({ error: 'You do not have permission to reconcile bank transactions.' }, 403)

  const result = { by_utr: 0, by_name: 0, by_amount: 0, review: 0, ai: true as boolean, note: '' }

  try {
    const { data: lines, error: lErr } = await db.from('bank_transactions')
      .select('id, txn_date, description, debit_amount, utr_reference')
      .eq('matched', false).gt('debit_amount', 0).order('txn_date').limit(MAX_LINES)
    if (lErr) throw new Error(lErr.message)
    const { data: pays, error: pErr } = await db.from('supplier_bill_payments')
      .select('id, allocated_amount, utr_reference, supplier_bills!inner(internal_bill_number, status, supplier_text, suppliers(name))')
      .eq('mode', 'rtgs_neft').eq('confirmed', false).gt('allocated_amount', 0)
    if (pErr) throw new Error(pErr.message)

    // deno-lint-ignore no-explicit-any
    let pending = (pays || []).filter((p: any) => p.supplier_bills?.status !== 'void')
    const unmatched = new Map((lines || []).map((l) => [l.id as string, l]))
    if (!unmatched.size || !pending.length) return json({ ...result, note: 'Nothing to match.' })

    const confirm = async (bankId: string, paymentId: string) => {
      const { error } = await db.rpc('confirm_bank_match', { p_bank_transaction_id: bankId, p_payment_id: paymentId })
      if (error) return false
      unmatched.delete(bankId)
      // deno-lint-ignore no-explicit-any
      pending = pending.filter((p: any) => p.id !== paymentId)
      return true
    }

    // 1. UTR
    for (const l of [...unmatched.values()]) {
      if (!l.utr_reference) continue
      // deno-lint-ignore no-explicit-any
      const hit = pending.find((p: any) => p.utr_reference && p.utr_reference === l.utr_reference)
      if (hit && await confirm(l.id, hit.id)) result.by_utr++
    }

    // 2. Payee name, read by Claude
    const amountOnly: string[] = []
    if (!apiKey) {
      result.ai = false
      result.note = 'ANTHROPIC_API_KEY is not set, so payments were matched on amount only.'
      amountOnly.push(...unmatched.keys())
    } else if (unmatched.size && pending.length) {
      try {
        const todo = [...unmatched.values()]
        for (let i = 0; i < todo.length && pending.length; i += CHUNK) {
          const chunk = todo.slice(i, i + CHUNK)
          const payload = {
            pending_payments: pending.map((p: any) => ({
              payment_id: p.id,
              vendor: p.supplier_bills?.suppliers?.name || p.supplier_bills?.supplier_text || null,
              bill: p.supplier_bills?.internal_bill_number,
              amount: Number(p.allocated_amount),
            })),
            bank_debits: chunk.map((l) => ({ bank_id: l.id, date: l.txn_date, narration: l.description, amount: Number(l.debit_amount) })),
          }
          const out = await callAnthropic(apiKey, {
            model: MODEL,
            max_tokens: 4000,
            tools: [{ name: 'report_matches', description: 'Report, for each bank debit, the payee and the matching pending payment.', input_schema: SCHEMA }],
            tool_choice: { type: 'tool', name: 'report_matches' },
            messages: [{
              role: 'user',
              content: `Below are bank statement debits and pending RTGS/NEFT payments of a company. For each bank debit, read the narration and work out who is being paid (narrations are often abbreviated, truncated or upper-case, e.g. "RTGS-HDFCR5202-SHARMA PLY AND TIM-"). If that payee is one of the vendors on the pending payments, return that payment's id (if the vendor has several, the one closest in amount to the debit). If the narration names a payee that is not among the vendors, set payee_identified true and payment_id null. If the narration shows no readable payee name, set payee_identified false and payment_id null. Judge by the name only; never pick a payment because the amount looks similar.\n\n${JSON.stringify(payload)}`,
            }],
          })
          const tu = (out.content || []).find((c: any) => c.type === 'tool_use')
          for (const r of tu?.input?.lines || []) {
            const l = unmatched.get(r.bank_id)
            if (!l) continue
            if (r.payee_identified === false) { amountOnly.push(l.id); continue }
            if (r.payment_id) {
              const p = pending.find((x: any) => x.id === r.payment_id)
              if (p && within95(Number(p.allocated_amount), Number(l.debit_amount))) {
                if (await confirm(l.id, p.id)) { result.by_name++; continue }
              }
              result.review++ // payee recognised but the amount is off: a person decides
            }
          }
          // Lines Claude did not answer for are treated as unidentified.
          for (const l of chunk) {
            if (unmatched.has(l.id) && !amountOnly.includes(l.id) && !(tu?.input?.lines || []).some((r: any) => r.bank_id === l.id)) amountOnly.push(l.id)
          }
        }
      } catch (e) {
        result.ai = false
        result.note = `Claude could not be reached (${(e as Error).message.slice(0, 120)}); remaining lines were matched on amount only.`
        amountOnly.length = 0
        amountOnly.push(...unmatched.keys())
      }
    }

    // 3. Amount only, for lines whose payee could not be identified
    if (amountOnly.length) {
      const { data: n, error } = await db.rpc('auto_match_bank_transactions', { p_ids: [...new Set(amountOnly)] })
      if (error) throw new Error(error.message)
      result.by_amount = Number(n || 0)
    }
    return json(result)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
