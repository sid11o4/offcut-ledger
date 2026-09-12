// Reads a photographed "PVC Edgebanding Usage Log" paper sheet and extracts exactly three
// things per row -- Project, Edgeband Thickness, Total Meters -- using Claude's vision. This
// NEVER writes a job-work entry itself: it only fills in scanned_edgeband_rows for a human to
// review, correct, and confirm from the Daily Log UI, which then calls the same
// record_job_work_entry() RPC the manual form uses. The calculation engine, rates and billing
// are completely untouched by this function.
//
// POST body: { batch_id }
// Requires the ANTHROPIC_API_KEY secret to be set on this project (supabase secrets set).
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

const EXTRACT_TOOL = {
  name: 'extract_log',
  description: 'Report the rows found on the photographed edgeband usage log sheet.',
  input_schema: {
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
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  // 1. Verify the caller is a signed-in, active user (same bar as the manual Daily Log form).
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: caller } } = await asCaller.auth.getUser()
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY is not configured on this project. Ask an admin to add it via `supabase secrets set`.' }, 500)

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
    const mediaType = /\.png$/i.test(batch.image_path) ? 'image/png' : /\.webp$/i.test(batch.image_path) ? 'image/webp' : 'image/jpeg'

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

Extract ONLY: for every non-blank row, its S.No, the Project, the Edgeband Code/Thickness, and the Total Meters value.
Ignore the header fields (Machine, Date, Operator/Shift) and the Remarks/Signature column entirely -- do not report them.

Known projects (match project_text against this list; project_match must be an exact copy from here or null):
${projectNames.length ? projectNames.map((n) => `- ${n}`).join('\n') : '(none on file)'}

Known edgeband job-work items (match edgeband_text against this list; edgeband_match must be an exact copy from here or null):
${edgebandNames.map((n) => `- ${n}`).join('\n')}

Call extract_log with one entry per non-blank row. Skip rows that are entirely empty.`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'extract_log' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
    if (!resp.ok) throw new Error(`Claude API error (${resp.status}): ${await resp.text()}`)
    const result = await resp.json()
    const toolUse = (result.content || []).find((c: { type: string }) => c.type === 'tool_use')
    if (!toolUse) throw new Error('Claude did not return structured extraction output.')
    const rows: Array<{
      row_no: number; project_text?: string | null; project_match?: string | null
      edgeband_text?: string | null; edgeband_match?: string | null
      total_meters?: number | null; flag?: string | null
    }> = toolUse.input?.rows || []

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
