// Reads a photographed "PVC Edgebanding Usage Log" paper sheet and extracts exactly three
// things per row -- Project, Edgeband Thickness, Total Meters -- using Google Gemini's vision +
// structured-output mode. This NEVER writes a job-work entry itself: it only fills in
// scanned_edgeband_rows for a human to review, correct, and confirm from the Daily Log UI,
// which then calls the same record_job_work_entry() RPC the manual form uses. The calculation
// engine, rates and billing are completely untouched by this function.
//
// Runs on Gemini (gemini-2.5-flash), not Anthropic, by request -- it has a genuinely free API
// tier (console.anthropic.com requires billing for every call; aistudio.google.com does not).
// Get a free key at aistudio.google.com/apikey and set it as the GEMINI_API_KEY secret on this
// project (Supabase dashboard -> Edge Functions -> Secrets).
//
// POST body: { batch_id }
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Plain JSON Schema, converted to Gemini's responseSchema dialect at call time by
// toGeminiSchema() -- see extract-supplier-bill-scan for the same pattern.
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row_no: { type: 'integer', description: 'The S.No printed on that row.' },
          project_text: { type: ['string', 'null'], description: 'The handwritten project text, verbatim, or null if the row is blank.' },
          project_match: { type: ['string', 'null'], description: 'The EXACT name (copied character-for-character) from the provided project list, only if you are confident it is the same project. Otherwise null.' },
          edgeband_text: { type: ['string', 'null'], description: 'The handwritten edgeband code/thickness text, verbatim.' },
          edgeband_match: { type: ['string', 'null'], description: 'The EXACT name (copied character-for-character) from the provided job-work list, only if confident. Otherwise null.' },
          total_meters: { type: ['number', 'null'], description: 'The value in the "Total Meters" column. If that cell is blank/illegible but the Start No. and End No. are BOTH clearly legible, compute End − Start instead. Otherwise null.' },
          flag: { type: ['string', 'null'], description: 'Short note on anything uncertain or illegible in this row; null if everything was clear.' },
        },
        required: ['row_no'],
      },
    },
  },
  required: ['rows'],
}

// deno-lint-ignore no-explicit-any
function toGeminiSchema(schema: any): any {
  if (schema == null || typeof schema !== 'object') return schema
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const nonNull = types.find((t: string) => t && t !== 'null')
  // deno-lint-ignore no-explicit-any
  const out: any = {}
  if (nonNull) out.type = String(nonNull).toUpperCase()
  if (types.includes('null')) out.nullable = true
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum
  if (schema.required) out.required = schema.required
  if (schema.properties) {
    out.properties = {}
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v)
  }
  if (schema.items) out.items = toGeminiSchema(schema.items)
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  // 1. Verify the caller is a signed-in, active user (same bar as the manual Daily Log form).
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: caller } } = await asCaller.auth.getUser()
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  console.log('extract-edgeband-scan: geminiKey present =', !!geminiKey, 'length =', geminiKey?.length ?? 0)
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured on this project. Get a free key at aistudio.google.com/apikey and add it via the Supabase dashboard (Edge Functions -> Secrets).' }, 500)

  let body: { batch_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const batchId = String(body.batch_id ?? '')
  if (!batchId) return json({ error: 'batch_id is required.' }, 400)

  const admin = createClient(url, serviceKey)

  const { data: batch, error: batchErr } = await admin.from('scanned_edgeband_batches').select('*').eq('id', batchId).single()
  if (batchErr || !batch) return json({ error: 'Batch not found.' }, 404)
  if (batch.created_by !== caller.id) return json({ error: 'You can only extract a batch you uploaded.' }, 403)

  try {
    const { data: fileBlob, error: dlErr } = await admin.storage.from('scan-uploads').download(batch.image_path)
    if (dlErr || !fileBlob) throw new Error('Could not read the uploaded image.')
    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    const imageBase64 = encodeBase64(bytes)
    const mimeType = /\.png$/i.test(batch.image_path) ? 'image/png' : /\.webp$/i.test(batch.image_path) ? 'image/webp' : 'image/jpeg'

    const [{ data: projects }, { data: services }] = await Promise.all([
      admin.from('projects').select('id, name').neq('status', 'cancelled'),
      admin.from('job_work_services').select('id, name').eq('is_composite', false).eq('active', true),
    ])
    const projectIdMap = new Map((projects || []).map((p: { id: string; name: string }) => [p.name, p.id]))
    const projectNames = [...projectIdMap.keys()]
    const edgebandServices = (services || []).filter((s: { name: string }) => /edgeband/i.test(s.name))
    const candidateServices = edgebandServices.length ? edgebandServices : services || []
    const serviceIdMap = new Map(candidateServices.map((s: { id: string; name: string }) => [s.name, s.id]))
    const edgebandNames = [...serviceIdMap.keys()]

    const prompt = `This is a photo of a paper "PVC Edgebanding Usage Log" filled in by hand. It is a table with columns:
S.No | Project | Edgeband Code/Thickness | Start No. | End No. | Total Meters (End − Start) | Remarks/Signature

Extract ONLY: for every non-blank row, its S.No, the Project, the Edgeband Code/Thickness, and the Total Meters value, into the given JSON schema.
Ignore the header fields (Machine, Date, Operator/Shift) and the Remarks/Signature column entirely -- do not report them. Skip rows that are entirely empty.

Known projects (match project_text against this list; project_match must be an exact copy from here or null):
${projectNames.length ? projectNames.map((n) => `- ${n}`).join('\n') : '(none on file)'}

Known edgeband job-work items (match edgeband_text against this list; edgeband_match must be an exact copy from here or null):
${edgebandNames.map((n) => `- ${n}`).join('\n')}`

    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(EXTRACT_SCHEMA),
          },
        }),
      },
    )
    if (!resp.ok) throw new Error(`Gemini API error (${resp.status}): ${await resp.text()}`)
    const result = await resp.json()
    if (result.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked this request: ${result.promptFeedback.blockReason}`)
    }
    // deno-lint-ignore no-explicit-any
    const textPart = (result.candidates?.[0]?.content?.parts || []).find((p: any) => typeof p.text === 'string')
    if (!textPart) throw new Error(`Gemini did not return structured extraction output. Response: ${JSON.stringify(result).slice(0, 500)}`)
    // deno-lint-ignore no-explicit-any
    let extracted: any
    try {
      extracted = JSON.parse(textPart.text)
    } catch {
      throw new Error(`Gemini returned non-JSON output: ${textPart.text.slice(0, 500)}`)
    }
    const rows: Array<{
      row_no: number; project_text?: string | null; project_match?: string | null
      edgeband_text?: string | null; edgeband_match?: string | null
      total_meters?: number | null; flag?: string | null
    }> = extracted.rows || []

    const insertRows = rows
      .filter((r) => r.project_text || r.edgeband_text || r.total_meters != null)
      .map((r) => ({
        batch_id: batchId,
        row_no: r.row_no,
        project_text: r.project_text ?? null,
        project_id: r.project_match ? projectIdMap.get(r.project_match) ?? null : null,
        edgeband_text: r.edgeband_text ?? null,
        service_id: r.edgeband_match ? serviceIdMap.get(r.edgeband_match) ?? null : null,
        total_meters: r.total_meters ?? null,
        flag: r.flag ?? null,
      }))

    if (insertRows.length) {
      const { error: insErr } = await admin.from('scanned_edgeband_rows').insert(insertRows)
      if (insErr) throw insErr
    }

    await admin.from('scanned_edgeband_batches').update({ status: 'extracted', raw_extraction: { rows } }).eq('id', batchId)
    return json({ ok: true, rows_extracted: insertRows.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await admin.from('scanned_edgeband_batches').update({ status: 'failed', error: message }).eq('id', batchId)
    return json({ error: message }, 500)
  }
})
