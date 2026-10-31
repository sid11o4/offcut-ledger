// Answers questions about the business from live data, for the top search bar.
// The caller's own JWT is used for every read, so Row Level Security and the has_permission()
// checks decide what is visible. A section the caller cannot read is reported to the model as
// "NOT PERMITTED" instead of leaking numbers. An optional attachment (image or PDF) is read by
// the model alongside the question. The model can run read-only SELECTs (run_sql) to find any figure,
// and proposes changes for approval; nothing is written here.
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
      scope: {
        type: 'string',
        enum: ['factory', 'design_build', 'both'],
        description: 'Which business the question is about: factory, design_build, or both only when it asks for both.',
      },
    },
    required: ['summary', 'sections', 'follow_ups', 'not_permitted', 'scope'],
  },
}

// Reads the database. The query runs as the signed-in user, so Row Level Security applies. The
// assistant can call this several times to gather what it needs before answering.
const RUN_SQL_TOOL = {
  name: 'run_sql',
  description: 'Run one read-only SELECT against the FORMGRID database and get the rows back as JSON (up to 1000 rows). Use it to look up any figure you need. To see table or column names, query information_schema.columns. Amounts are in rupees.',
  input_schema: {
    type: 'object',
    properties: { sql: { type: 'string', description: 'A single SELECT (or WITH ... SELECT) statement.' } },
    required: ['sql'],
  },
}

// Proposes a change. Nothing is written here; the browser shows the proposal and only runs it
// through assistant-execute after the user approves.
const PROPOSE_TOOL = {
  name: 'propose_action',
  description: 'Use when the user asks to create, change or delete data: a supplier bill (create_bill, update_bill, delete_bill) or any other record (change). Describe the change; do not execute it.',
  input_schema: {
    type: 'object',
    properties: {
      action_type: { type: 'string', enum: ['create_bill', 'update_bill', 'delete_bill', 'change'] },
      operation: { type: ['string', 'null'], enum: ['insert', 'update', 'delete', null], description: 'For change: insert adds a record, update changes records, delete removes records.' },
      table: { type: ['string', 'null'], description: 'For change: the database table name, e.g. recurring_expenses, expenses, suppliers.' },
      values: { type: ['object', 'null'], description: 'For change insert and update: field name to new value. For a linked record such as a category, give its name, not an id.' },
      match: { type: ['object', 'null'], description: 'For change update and delete: field name to value identifying the records it applies to, e.g. {"name": "Rent"}.' },
      summary: { type: 'string', description: 'One sentence describing exactly what will happen, in plain words.' },
      bill_number: { type: ['string', 'null'], description: 'For update_bill and delete_bill: the internal bill number, e.g. FG-2587.' },
      supplier_name: { type: ['string', 'null'], description: 'For create_bill.' },
      create_supplier: { type: 'boolean', description: 'True when the supplier is not on file and the user wants it added as a new supplier.' },
      create_project: { type: 'boolean', description: 'True when the Design Build project is not on file and the user wants it created.' },
      project_name: { type: ['string', 'null'], description: 'Design Build project name, or null for company-level.' },
      bill_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      grand_total: { type: ['number', 'null'] },
      remarks: { type: ['string', 'null'] },
      payments: {
        type: 'array',
        description: 'For create_bill: every payment row on the bill. Amounts must add up to grand_total.',
        items: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['cash', 'rtgs_neft', 'credit'] },
            amount: { type: 'number' },
            utr_reference: { type: ['string', 'null'] },
          },
          required: ['mode', 'amount'],
        },
      },
      changes: {
        type: ['object', 'null'],
        description: 'For update_bill: only the fields to change. Keys: bill_date, grand_total, remarks, supplier_name, project_name.',
      },
    },
    required: ['action_type', 'summary'],
  },
}

// The user id from the caller's JWT. The database has already checked the token when the RPC below
// runs with it, so reading the id here only needs the payload.
function userIdFromToken(authHeader: string): string | null {
  const part = authHeader.replace(/^Bearer\s+/i, '').split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
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
  if (!userIdFromToken(authHeader)) return json({ error: 'Not signed in.' }, 401)
  const { data: active, error: activeError } = await db.rpc('is_active_user')
  if (activeError) return json({ error: 'Not signed in.' }, 401)
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
Two businesses exist: Factory (job-work, billing, expenses, Factory income and statement) and Design Build (projects, supplier bills tagged to a project, company inventory, the Design Build ledger). Set scope to the business the question is about, and to both only when it asks for both.
Amounts are Indian rupees, formatted with commas (e.g. ₹40,180). Give the direct answer in summary, back it with tables in sections, and link to the matching in-app page when one exists (/design-build/ledger, /design-build/inventory, /accounts/bills, /statement, /reports, /billing/<id>).
If an attached file is a bill or slip, describe what it contains in a table and say that it has not been saved.
If a needed section says NOT PERMITTED, set not_permitted to true and say the user lacks access. Never guess numbers that are not in the context.
Use run_sql to look up any figure you need, several times if needed; query information_schema.columns to find table and column names. Amounts in run_sql results are rupees. Answer only from the query results.
If the user asks to create, change or delete a supplier bill, call propose_action instead of answer.
If the user asks to add, change or remove any other record, call propose_action with action_type change: operation (insert, update or delete), table (the database table name), values (field name to new value; give linked records by name, e.g. the category name), and match for update or delete (the field and value that identify the records). Write the summary in plain English for a finance user, saying what will be added, changed or removed and where. Use it only for a change the user has asked for. Fill only the fields the user stated, and never invent a number, date or supplier. Dates are YYYY-MM-DD. For create_bill, put every payment row in payments. Set create_supplier or create_project to true when the named supplier or project is not on file; the review will show it as a new record. The bar does not save line items; say so in the summary when the user's bill has them, and point to the Bill Audit Queue. The change is not made until the user approves it.`

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

  const messages: unknown[] = [{ role: 'user', content: userContent }]
  for (let round = 0; round < 8; round++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: [RUN_SQL_TOOL, ANSWER_TOOL, PROPOSE_TOOL],
        tool_choice: { type: 'any' },
        messages,
      }),
    })
    if (!resp.ok) return json({ error: `Anthropic API error (${resp.status}): ${await resp.text()}` }, 500)
    const result = await resp.json()
    // deno-lint-ignore no-explicit-any
    const content: any[] = result.content || []
    const finalUse = content.find((c) => c.type === 'tool_use' && (c.name === 'answer' || c.name === 'propose_action'))
    if (finalUse) {
      if (finalUse.name === 'propose_action') return json({ proposal: finalUse.input })
      return json({ answer: finalUse.input })
    }
    const queries = content.filter((c) => c.type === 'tool_use' && c.name === 'run_sql')
    if (queries.length === 0) return json({ error: 'The assistant did not return an answer.' }, 500)

    messages.push({ role: 'assistant', content })
    const results = []
    for (const q of queries) {
      const { data, error } = await db.rpc('ai_run_read', { p_sql: String(q.input?.sql ?? '') })
      results.push({
        type: 'tool_result',
        tool_use_id: q.id,
        content: error ? `Query error: ${error.message}` : JSON.stringify(data).slice(0, 60000),
        is_error: Boolean(error),
      })
    }
    messages.push({ role: 'user', content: results })
  }
  return json({ error: 'The question needed too many lookups. Ask a narrower question.' }, 500)
})
