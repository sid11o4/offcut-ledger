// Answers questions about the business from live data, for the top search bar.
// The caller's own JWT is used for every read, so Row Level Security and the has_permission()
// checks decide what is visible. A section the caller cannot read is reported to the model as
// "NOT PERMITTED" instead of leaking numbers. An optional attachment (image or PDF) is read by
// the model alongside the question. This function never writes data.
//
// Model: Claude Haiku 5.5 only (ANTHROPIC_API_KEY).
//
// POST body: { question: string, attachment?: { mime: string, base64: string } }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MODEL = 'claude-haiku-5-5'
const ALLOWED_ATTACHMENTS = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
const MAX_ATTACHMENT_CHARS = 6_000_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ANSWER_TOOL = {
  name: 'answer',
  description: 'Return the answer as structured sections so it can be shown as tables with links.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two sentences answering the question directly.' },
      sections: {
        type: 'array',
        description: 'Tables that back up the answer. Use an empty array if no table is needed.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            columns: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            link: { type: ['string', 'null'], description: 'An in-app path such as /design-build/ledger or /billing/<id>, if one fits.' },
          },
          required: ['title', 'columns', 'rows'],
        },
      },
      follow_ups: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to three short questions the user would likely ask next.',
      },
      not_permitted: { type: 'boolean', description: 'True if the answer needs data the user cannot see.' },
    },
    required: ['summary', 'sections', 'follow_ups', 'not_permitted'],
  },
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

  let body: { question?: string; attachment?: { mime?: string; base64?: string } }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const question = String(body.question ?? '').trim().slice(0, 1000)
  const attachment = body.attachment
  if (!question && !attachment) return json({ error: 'Type a question or attach a file.' }, 400)
  if (attachment) {
    if (!attachment.mime || !ALLOWED_ATTACHMENTS.has(attachment.mime)) return json({ error: 'Attach a PNG, JPG, WEBP or PDF.' }, 400)
    if (!attachment.base64 || attachment.base64.length > MAX_ATTACHMENT_CHARS) return json({ error: 'Attachment is missing or too large.' }, 400)
  }

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
    tryRead('supplier_bills_pending_review', () => db.from('supplier_bills').select('id, internal_bill_number, grand_total, bill_date, supplier_text').eq('status', 'pending_review').limit(50)),
    tryRead('recent_expenses', () => db.from('expenses').select('expense_date, amount, description').eq('status', 'active').order('expense_date', { ascending: false }).limit(20)),
  ])

  const system = `You answer questions about FORMGRID's business data using ONLY the JSON context and any attached file.
Two businesses exist: Factory (job-work, billing, expenses) and Design Build (projects, supplier bills, inventory, ledger).
Amounts are Indian rupees, formatted with commas (e.g. ₹40,180). Give the direct answer in summary, back it with tables in sections, and link to the matching in-app page when one exists (/design-build/ledger, /design-build/inventory, /accounts/bills, /statement, /reports, /billing/<id>).
If an attached file is a bill or slip, describe what it contains in a table and say that it has not been saved.
If a needed section says NOT PERMITTED, set not_permitted to true and say the user lacks access. Never guess numbers that are not in the context.`

  const userContent: unknown[] = []
  if (attachment?.mime && attachment.base64) {
    userContent.push(attachment.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: attachment.mime, data: attachment.base64 } })
  }
  userContent.push({
    type: 'text',
    text: `Today is ${today}.\n\nData context (JSON):\n${JSON.stringify(sections)}\n\nQuestion: ${question || 'Read the attached file and describe it.'}`,
  })

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      tools: [ANSWER_TOOL],
      tool_choice: { type: 'tool', name: 'answer' },
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  if (!resp.ok) return json({ error: `Anthropic API error (${resp.status}): ${await resp.text()}` }, 500)
  const result = await resp.json()
  // deno-lint-ignore no-explicit-any
  const toolUse = (result.content || []).find((c: any) => c.type === 'tool_use')
  if (!toolUse) return json({ error: 'The assistant did not return an answer.' }, 500)
  return json({ answer: toolUse.input })
})
