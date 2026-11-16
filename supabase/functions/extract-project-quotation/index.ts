// Reads an uploaded client quotation (PDF or image) with Claude Haiku 5.5 and returns its scope
// lines in a fixed shape. It only stores what it read on the project_quotations row
// (extracted, extracted_at); it never changes the scope of work. A person reviews the lines and
// applies them from the Collections page.
//
// Requires the ANTHROPIC_API_KEY secret. POST body: { quotation_id }
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const MODEL = 'claude-haiku-5-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const QUOTE_SCHEMA = {
  type: 'object',
  properties: {
    client_name: { type: ['string', 'null'] },
    quote_number: { type: ['string', 'null'], description: 'The quotation number or reference, as printed.' },
    quote_date: { type: ['string', 'null'], description: 'The quotation date as an ISO YYYY-MM-DD date.' },
    quoted_total: { type: ['number', 'null'], description: 'The grand total of the quotation as printed. Null if not printed.' },
    items: {
      type: 'array',
      description: 'Every scope line of work or supply in the quotation. Exclude subtotals, taxes, discounts, payment terms and terms and conditions.',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The item or work description, verbatim.' },
          unit: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          rate: { type: ['number', 'null'], description: 'The unit rate as printed.' },
          amount: { type: 'number', description: 'The line total as printed. If the quotation shows GST separately, use the amount before GST and say so in notes.' },
        },
        required: ['description', 'amount'],
      },
    },
    notes: { type: ['string', 'null'], description: 'Anything a reviewer must know: GST treatment, unreadable lines, assumptions.' },
  },
  required: ['items'],
}

// Anthropic answers a transient overload with 529 (or 503); retry those with backoff.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: caller } } = await asCaller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on this project. Add it under Supabase dashboard -> Edge Functions -> Secrets.' }, 500)

  let body: { quotation_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const quotationId = String(body.quotation_id ?? '')
  if (!quotationId) return json({ error: 'quotation_id is required.' }, 400)

  // Read and write as the caller, so row-level security decides who may touch the quotation.
  const { data: quote, error: qErr } = await asCaller.from('project_quotations').select('*').eq('id', quotationId).single()
  if (qErr || !quote) return json({ error: 'Quotation not found or not allowed.' }, 404)
  if (!quote.file_path) return json({ error: 'This quotation has no file.' }, 400)

  try {
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: fileBlob, error: dlErr } = await admin.storage.from('scan-uploads').download(quote.file_path)
    if (dlErr || !fileBlob) throw new Error('Could not read the uploaded quotation.')
    const fileBase64 = encodeBase64(new Uint8Array(await fileBlob.arrayBuffer()))
    const path = String(quote.file_path)
    const mediaType = /\.pdf$/i.test(path) ? 'application/pdf'
      : /\.png$/i.test(path) ? 'image/png'
      : /\.webp$/i.test(path) ? 'image/webp'
      : 'image/jpeg'
    const fileBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }

    const result = await callAnthropic(apiKey, {
      model: MODEL,
      max_tokens: 8000,
      tools: [{
        name: 'extract_quotation',
        description: 'Report the scope lines and totals of the client quotation.',
        input_schema: QUOTE_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'extract_quotation' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'This is a client quotation for an interior or fabrication project. Read every page. Report each scope line with its description, unit, quantity, rate and amount exactly as printed, the quotation total, and the quotation number and date. Do not compute or correct any figure yourself; report what is printed.' },
          fileBlock,
          { type: 'text', text: 'Call extract_quotation with everything found in the quotation.' },
        ],
      }],
    })
    // deno-lint-ignore no-explicit-any
    const toolUse = (result.content || []).find((c: any) => c.type === 'tool_use')
    if (!toolUse) throw new Error('Claude did not return structured output for this quotation.')
    const extracted = toolUse.input || { items: [] }

    const { error: upErr } = await asCaller.from('project_quotations').update({
      extracted,
      extracted_at: new Date().toISOString(),
      quoted_total: extracted.quoted_total ?? quote.quoted_total,
      quoted_on: extracted.quote_date || quote.quoted_on,
    }).eq('id', quotationId)
    if (upErr) throw new Error(upErr.message)

    return json({ extracted })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
