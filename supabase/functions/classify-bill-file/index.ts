// Tells apart the documents uploaded together for one bill: FORMGRID's own bill slip, the vendor's
// bill, a GST invoice, or anything else. Each file is classified on its own, so a batch can hold
// several kinds at once. Runs on the caller's session, so only files they can read are classified.
// Model: Claude Haiku 5.5 only (ANTHROPIC_API_KEY). Nothing is written here.
//
// POST body: { path: string, mime: string }
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const MODEL = 'claude-haiku-5-5'
const ALLOWED_MODELS = new Set(['claude-haiku-5-5'])
if (!ALLOWED_MODELS.has(MODEL)) throw new Error(`Model ${MODEL} is not allowed for document classification`)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])

const CLASSIFY_TOOL = {
  name: 'classify_upload',
  description: 'Report which kind of document this file is.',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['formgrid_slip', 'vendor_bill', 'gst_invoice', 'other'],
        description: 'formgrid_slip = FORMGRID\'s own "Bill / Payment Slip" (Bill No., Type of Expense and Cost Head boxes). vendor_bill = a bill or invoice issued by the supplier, without the FORMGRID slip layout. gst_invoice = a GST tax invoice (GSTIN, HSN/SAC, CGST/SGST or IGST lines). other = anything else, such as a receipt, delivery challan or note.',
      },
      confidence: { type: 'number', description: '0-1 confidence in the kind.' },
      reason: { type: 'string', description: 'One short sentence on what in the document shows the kind.' },
      vendor_invoice_number: { type: ['string', 'null'], description: 'The vendor\'s own invoice or bill number if printed, else null.' },
      formgrid_bill_number: { type: ['string', 'null'], description: 'The FORMGRID bill number written by hand or printed at the top of a vendor or GST document, e.g. FG-2587. Null if there is none.' },
    },
    required: ['kind', 'confidence', 'reason'],
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
  const { data: { user } } = await asCaller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""))
  if (!user) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  let body: { path?: string; mime?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const path = String(body.path ?? '')
  const mime = String(body.mime ?? '')
  if (!path) return json({ error: 'path is required.' }, 400)
  if (!ALLOWED_MIME.has(mime)) return json({ error: 'Only PNG, JPG, WEBP or PDF can be classified.' }, 400)

  try {
    const { data: fileBlob, error: dlErr } = await asCaller.storage.from('scan-uploads').download(path)
    if (dlErr || !fileBlob) return json({ error: 'Could not read the uploaded file.' }, 404)
    const fileBase64 = encodeBase64(new Uint8Array(await fileBlob.arrayBuffer()))
    const fileBlock = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mime, data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: fileBase64 } }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: 'classify_upload' },
        messages: [{
          role: 'user',
          content: [fileBlock, {
            type: 'text',
            text: 'This document was uploaded for one bill in a small interior firm\'s accounts. Classify it with classify_upload. Choose formgrid_slip only when the layout is FORMGRID\'s own slip; a vendor\'s printed invoice is vendor_bill, or gst_invoice when it carries GST lines.',
          }],
        }],
      }),
    })
    if (!resp.ok) return json({ error: `Anthropic API error (${resp.status}): ${await resp.text()}` }, 500)
    const result = await resp.json()
    // deno-lint-ignore no-explicit-any
    const toolUse = (result.content || []).find((c: any) => c.type === 'tool_use')
    if (!toolUse) return json({ error: 'The classifier did not return a result.' }, 500)
    return json({ classification: toolUse.input })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
