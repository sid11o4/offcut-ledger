// Decides how the pages of a multi-page PDF group into bills: pages that continue one bill stay
// together, a page that starts a different bill starts a new group. The browser then cuts the PDF
// along these groups and scans each one as its own bill.
// Model: Claude Haiku 5.5 only (ANTHROPIC_API_KEY). Nothing is written here; runs on the caller's session.
//
// POST body: { path: string, page_count: number }
// Reply:     { groups: number[][] }  -- every page 1..page_count exactly once, in order.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const MODEL = 'claude-haiku-5-5'
const ALLOWED_MODELS = new Set(['claude-haiku-5-5'])
if (!ALLOWED_MODELS.has(MODEL)) throw new Error(`Model ${MODEL} is not allowed for page analysis`)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const TOOL = {
  name: 'group_pages',
  description: 'Report which pages of this PDF belong to the same bill.',
  input_schema: {
    type: 'object',
    properties: {
      bills: {
        type: 'array',
        description: 'One entry per distinct bill, in page order. Every page of the PDF appears in exactly one entry.',
        items: {
          type: 'object',
          properties: {
            pages: { type: 'array', items: { type: 'integer' }, description: '1-based page numbers of this bill, ascending.' },
            reason: { type: 'string', description: 'One short sentence: what ties these pages together (same invoice number, "page 2 of 3", items continuing) or why a new bill starts here.' },
          },
          required: ['pages', 'reason'],
        },
      },
    },
    required: ['bills'],
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

  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await asCaller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  let body: { path?: string; page_count?: number }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const path = String(body.path ?? '')
  const pageCount = Number(body.page_count)
  if (!path) return json({ error: 'path is required.' }, 400)
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100) return json({ error: 'page_count must be 1 to 100.' }, 400)
  if (pageCount === 1) return json({ groups: [[1]] })

  try {
    const { data: fileBlob, error: dlErr } = await asCaller.storage.from('scan-uploads').download(path)
    if (dlErr || !fileBlob) return json({ error: 'Could not read the uploaded file.' }, 404)
    const data = encodeBase64(new Uint8Array(await fileBlob.arrayBuffer()))

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'group_pages' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
            {
              type: 'text',
              text: `This PDF has ${pageCount} pages. It was scanned or exported from a pile of papers for a small interior firm's accounts, and may hold several different bills, or one bill spread over several pages. Decide which pages belong together and report it with group_pages.

Pages belong to the SAME bill when: they carry the same invoice / bill number, the page says "page 2 of 3" or similar, the item table simply continues without a new header, or only the last page carries the totals, GST summary and signature. A page is a DIFFERENT bill when it has its own invoice number, its own supplier, date and totals. A FORMGRID "Bill / Payment Slip" page is always its own bill, however many there are. A terms page, delivery note or blank back page belongs to the bill before it.

Every page from 1 to ${pageCount} must appear exactly once, in order. When in doubt whether two pages are one bill, keep them together.`,
            },
          ],
        }],
      }),
    })
    if (!resp.ok) return json({ error: `Anthropic API error (${resp.status}): ${await resp.text()}` }, 500)
    const result = await resp.json()
    // deno-lint-ignore no-explicit-any
    const toolUse = (result.content || []).find((c: any) => c.type === 'tool_use')
    // deno-lint-ignore no-explicit-any
    const bills: { pages: number[] }[] = toolUse?.input?.bills
    if (!Array.isArray(bills)) return json({ error: 'The analysis did not return groups.' }, 500)

    // Every page exactly once and in order; otherwise the caller keeps the PDF as one bill.
    const flat = bills.flatMap((b) => (Array.isArray(b.pages) ? [...b.pages].sort((a, c) => a - c) : []))
    const ok = flat.length === pageCount && flat.every((p, i) => p === i + 1)
    if (!ok) return json({ error: 'The page groups did not cover every page once.' }, 422)
    const groups = bills.map((b) => [...b.pages].sort((a, c) => a - c)).sort((a, b) => a[0] - b[0])
    return json({ groups })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
