// Answers questions about the business from live data, for the top search bar.
// The caller's own JWT is used for every read, so Row Level Security and the has_permission()
// checks decide what is visible. A section the caller cannot read is reported to the model as
// "not permitted" instead of leaking numbers. This function never writes data.
//
// Model: Claude Haiku 5.5 only (ANTHROPIC_API_KEY).
//
// POST body: { question: string }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MODEL = 'claude-haiku-5-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on this project.' }, 500)

  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await db.auth.getUser()
  if (!user) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await db.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  let body: { question?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const question = String(body.question ?? '').trim().slice(0, 1000)
  if (!question) return json({ error: 'question is required.' }, 400)

  // Each section is read with the caller's own permissions. Errors mean "not permitted".
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 8) + '01'
  const sections: Record<string, unknown> = {}
  const tryRead = async (name: string, fn: () => PromiseLike<{ data: unknown; error: unknown }>) => {
    try {
      const { data, error } = await fn()
      sections[name] = error ? 'NOT PERMITTED for this user' : data
    } catch {
      sections[name] = 'NOT PERMITTED for this user'
    }
  }

  await Promise.all([
    tryRead('factory_income_expense_this_month', () => db.rpc('income_expense_statement', { p_start: monthStart, p_end: today })),
    tryRead('design_build_statement_this_month', () => db.rpc('design_build_statement', { p_start: monthStart, p_end: today })),
    tryRead('design_build_projects', () => db.rpc('report_design_projects_summary')),
    tryRead('company_inventory', () => db.rpc('report_company_inventory_value')),
    tryRead('supplier_bills_pending_review', () => db.from('supplier_bills').select('internal_bill_number, grand_total, bill_date, supplier_text').eq('status', 'pending_review').limit(50)),
    tryRead('recent_expenses', () => db.from('expenses').select('expense_date, amount, description').eq('status', 'active').order('expense_date', { ascending: false }).limit(20)),
  ])

  const system = `You answer questions about FORMGRID's business data using ONLY the JSON context provided.
Two businesses exist: Factory (job-work, billing, expenses) and Design Build (projects, supplier bills, inventory).
Amounts are Indian rupees. If a section says NOT PERMITTED, say the user does not have access to that information. Never guess numbers that are not in the context. Be brief.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system,
      messages: [{
        role: 'user',
        content: `Today is ${today}.\n\nData context (JSON):\n${JSON.stringify(sections)}\n\nQuestion: ${question}`,
      }],
    }),
  })
  if (!resp.ok) return json({ error: `Anthropic API error (${resp.status}): ${await resp.text()}` }, 500)
  const result = await resp.json()
  // deno-lint-ignore no-explicit-any
  const text = (result.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
  return json({ answer: text })
})
