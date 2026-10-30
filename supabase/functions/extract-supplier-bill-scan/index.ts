// Reads a photographed "Bill / Payment Slip" and extracts its fields using Google Gemini's
// vision + structured-output mode, the same pattern as extract-edgeband-scan (0026): it ONLY
// writes a supplier_bills row in 'pending_review' plus its line items and payment allocations,
// for a human to audit, correct and approve from the Bill Audit Queue. Nothing here ever calls
// approve_supplier_bill() -- the calculation/GST/inventory-posting logic in that RPC is
// completely untouched by a scan.
//
// Also does the AI material/supplier correlation the spec calls for: a supplier or inventory
// item name read off the slip is matched against the known list, with a confidence score.
// >=95% confidence auto-applies the match (still logged to material_match_suggestions, so the
// decision stays visible and reversible); anything less is left for the auditor to confirm.
//
// Runs on Gemini (gemini-2.5-flash), not Anthropic, by request -- it has a genuinely free API
// tier (console.anthropic.com requires billing for every call; aistudio.google.com does not).
// Get a free key at aistudio.google.com/apikey and set it as the GEMINI_API_KEY secret on this
// project (Supabase dashboard -> Edge Functions -> Secrets).
//
// POST body: { bill_id }
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

const COST_HEADS = [
  'factory_labour', 'factory_consumables', 'site_labour', 'raw_boards',
  'laminate_veneer', 'fevicol_adhesives', 'employee_salary', 'other',
]

// Written once in plain JSON Schema (the same shape every other part of this codebase already
// reads), then converted to Gemini's OpenAPI-subset responseSchema at call time -- see
// toGeminiSchema() below. Keeps this declaration provider-agnostic if the backing model ever
// changes again.
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    bill_number: { type: ['string', 'null'], description: 'The handwritten/printed "Bill No." field.' },
    bill_number_confidence: { type: 'number', description: '0-1 confidence in the bill number reading.' },
    bill_date: { type: ['string', 'null'], description: 'The date field, as an ISO YYYY-MM-DD date.' },
    bill_date_confidence: { type: 'number' },
    supplier_text: { type: ['string', 'null'], description: 'The supplier name exactly as written.' },
    supplier_match: { type: ['string', 'null'], description: 'The EXACT name (character-for-character) from the known supplier list, only if confident this is the same supplier. Otherwise null.' },
    supplier_confidence: { type: 'number', description: '0-1 confidence that supplier_match is correct (0 if supplier_match is null).' },
    project_text: { type: ['string', 'null'], description: 'The Project Name/Code field exactly as written.' },
    project_match: { type: ['string', 'null'], description: 'The EXACT name (character-for-character) from the known Design Build project list, only if confident. Otherwise null.' },
    project_confidence: { type: 'number' },
    expense_nature: { type: 'string', enum: ['material', 'labour', 'both'], description: 'Which "Type of Expense" box(es) are ticked.' },
    cost_heads: {
      type: 'array', items: { type: 'string', enum: COST_HEADS },
      description: 'Every "Cost Head" box that is ticked, mapped to these keys: Factory Labour=factory_labour, Factory Consumables=factory_consumables, Site Labour=site_labour, Raw Boards=raw_boards, Laminate and Veneer=laminate_veneer, Fevicol/Adhesives=fevicol_adhesives, Employee Salary=employee_salary, Other=other.',
    },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The Description of Goods/Services, verbatim.' },
          item_type: { type: 'string', enum: ['material', 'labour'] },
          unit_text: { type: ['string', 'null'] },
          quantity: { type: 'number' },
          rate_inclusive: { type: 'number', description: 'The GST-inclusive rate for this line.' },
          gst_percent: { type: 'number', description: 'The GST % for this line (0, 5, 12, 18, or whatever is written).' },
          material_match: { type: ['string', 'null'], description: 'For a material line: the EXACT name (character-for-character) from the known inventory item list, only if confident this is the same product under a different term. Otherwise null.' },
          material_confidence: { type: 'number', description: '0-1 confidence that material_match is the same product (0 if material_match is null).' },
        },
        required: ['description', 'item_type', 'quantity', 'rate_inclusive', 'gst_percent'],
      },
    },
    payments: {
      type: 'array',
      description: 'Each non-blank row of the Payment Details table.',
      items: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['cash', 'rtgs_neft', 'credit'] },
          amount: { type: 'number' },
          utr_reference: { type: ['string', 'null'] },
          received_by: { type: ['string', 'null'], description: 'Only for the Cash Payment Received section.' },
        },
        required: ['mode', 'amount'],
      },
    },
    amount_in_words: { type: ['string', 'null'] },
    grand_total: { type: ['number', 'null'] },
    remarks: { type: ['string', 'null'] },
  },
  required: ['line_items', 'payments'],
}

// Translates plain JSON Schema (lowercase types, `type: ['string', 'null']` unions) into
// Gemini's responseSchema dialect: uppercase type names and a separate `nullable: true` flag
// instead of a type union -- https://ai.google.dev/gemini-api/docs/structured-output.
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

  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: caller } } = await asCaller.auth.getUser()
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await asCaller.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  console.log('extract-supplier-bill-scan: geminiKey present =', !!geminiKey, 'length =', geminiKey?.length ?? 0)
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured on this project. Get a free key at aistudio.google.com/apikey and add it via the Supabase dashboard (Edge Functions -> Secrets).' }, 500)

  let body: { bill_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const billId = String(body.bill_id ?? '')
  if (!billId) return json({ error: 'bill_id is required.' }, 400)

  const admin = createClient(url, serviceKey)

  const { data: bill, error: billErr } = await admin.from('supplier_bills').select('*').eq('id', billId).single()
  if (billErr || !bill) return json({ error: 'Bill not found.' }, 404)
  if (bill.created_by !== caller.id) return json({ error: 'You can only extract a bill you uploaded.' }, 403)
  if (!bill.scan_image_path) return json({ error: 'This bill has no scanned image.' }, 400)

  try {
    const { data: fileBlob, error: dlErr } = await admin.storage.from('scan-uploads').download(bill.scan_image_path)
    if (dlErr || !fileBlob) throw new Error('Could not read the uploaded image.')
    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    const fileBase64 = encodeBase64(bytes)
    const isPdf = /\.pdf$/i.test(bill.scan_image_path)
    const mimeType = isPdf ? 'application/pdf'
      : /\.png$/i.test(bill.scan_image_path) ? 'image/png'
      : /\.webp$/i.test(bill.scan_image_path) ? 'image/webp'
      : 'image/jpeg'

    const [{ data: suppliers }, { data: projects }, { data: items }] = await Promise.all([
      admin.from('suppliers').select('id, name').eq('active', true),
      admin.from('design_projects').select('id, name'),
      admin.from('inventory_items').select('id, name').eq('active', true),
    ])
    const supplierIdMap = new Map((suppliers || []).map((s: { id: string; name: string }) => [s.name, s.id]))
    const projectIdMap = new Map((projects || []).map((p: { id: string; name: string }) => [p.name, p.id]))
    const itemIdMap = new Map((items || []).map((i: { id: string; name: string }) => [i.name, i.id]))

    const prompt = `This is ${isPdf ? 'a scanned PDF (it may have more than one page -- read all of them; a front+back slip or a multi-page scan is still one bill)' : 'a photo'} of a FORMGRID "Bill / Payment Slip" -- an internal record of a supplier purchase. It has:
Header: Bill No., Date, Supplier Name, Project Name, Project Code, Type of Expense (checkboxes), Cost Head (checkboxes: Factory Labour, Site Labour, Laminate and Veneer, Employee Salary, Factory Consumables, Raw Boards, Fevicol/Adhesives, Other).
A line-item table: S.No, Description of Goods/Services, Type, Unit, Quantity, Rate (inclusive of GST), Total Amount (inclusive of GST), GST %.
Payment Details: a table of Payment Mode (Cash Paid / Account Transfer RTGS-NEFT / Added to Credit Account), Amount, Remarks -- and a separate Cash Payment Received section (amount, received by name) when a cash seal/stamp is present.
Amount in Words, Grand Total, Remarks, Prepared By.

Extract every field into the given JSON schema. Rates and totals are GST-inclusive as printed -- report rate_inclusive exactly as written, do not compute anything yourself. Use null for any field that is blank or illegible.

Known suppliers (match supplier_text against this list; supplier_match must be an exact copy from here or null):
${[...supplierIdMap.keys()].map((n) => `- ${n}`).join('\n') || '(none on file)'}

Known Design Build projects (match project_text against this list; project_match must be an exact copy from here or null):
${[...projectIdMap.keys()].map((n) => `- ${n}`).join('\n') || '(none on file)'}

Known inventory items (for each MATERIAL line, match its description against this list even when the wording differs -- e.g. "18mm MR Ply" and "Century Ply 18mm Marine Grade" can be the same product. material_match must be an exact copy from this list or null, with your genuine confidence 0-1 that it's the same product, not just a similar one):
${[...itemIdMap.keys()].map((n) => `- ${n}`).join('\n') || '(none on file)'}`

    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: fileBase64 } },
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

    const supplierId = extracted.supplier_match ? supplierIdMap.get(extracted.supplier_match) ?? null : null
    const designProjectId = extracted.project_match ? projectIdMap.get(extracted.project_match) ?? null : null

    const fieldConfidence = {
      bill_number: extracted.bill_number_confidence ?? null,
      bill_date: extracted.bill_date_confidence ?? null,
      supplier_name: extracted.supplier_confidence ?? null,
      project: extracted.project_confidence ?? null,
    }

    await admin.from('supplier_bills').update({
      internal_bill_number: extracted.bill_number || bill.internal_bill_number,
      bill_date: extracted.bill_date || bill.bill_date,
      supplier_id: supplierId,
      supplier_text: extracted.supplier_text ?? null,
      design_project_id: designProjectId,
      expense_nature: extracted.expense_nature || 'material',
      cost_heads: (extracted.cost_heads || []).filter((h: string) => COST_HEADS.includes(h)),
      amount_in_words: extracted.amount_in_words ?? null,
      remarks: extracted.remarks ?? null,
      field_confidence: fieldConfidence,
      prepared_by: caller.id,
    }).eq('id', billId)

    const lineItems = (extracted.line_items || []) as Array<{
      description: string; item_type: 'material' | 'labour'; unit_text?: string | null
      quantity: number; rate_inclusive: number; gst_percent: number
      material_match?: string | null; material_confidence?: number
    }>

    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i]
      const matchedItemId = li.material_match ? itemIdMap.get(li.material_match) ?? null : null
      const confidence = li.material_confidence ?? 0
      const autoApply = matchedItemId && confidence >= 0.95

      const { data: insertedItem, error: itemErr } = await admin.from('supplier_bill_items').insert({
        bill_id: billId,
        description: li.description,
        description_text: li.description,
        item_type: li.item_type,
        inventory_item_id: autoApply ? matchedItemId : null,
        unit_text: li.unit_text ?? null,
        quantity: li.quantity,
        rate_inclusive: li.rate_inclusive,
        gst_percent: li.gst_percent,
        field_confidence: { material_match: confidence },
        sort_order: i,
      }).select().single()
      if (itemErr) throw itemErr

      if (matchedItemId && li.item_type === 'material') {
        await admin.from('material_match_suggestions').insert({
          supplier_bill_item_id: insertedItem.id,
          suggested_inventory_item_id: matchedItemId,
          confidence,
          status: autoApply ? 'confirmed' : 'pending',
          reasoning: `Matched "${li.description}" to "${li.material_match}".`,
          decided_by: autoApply ? null : null,
          decided_at: autoApply ? new Date().toISOString() : null,
        })
      }
    }

    const payments = (extracted.payments || []) as Array<{
      mode: 'cash' | 'rtgs_neft' | 'credit'; amount: number; utr_reference?: string | null; received_by?: string | null
    }>
    for (const p of payments) {
      await admin.from('supplier_bill_payments').insert({
        bill_id: billId, mode: p.mode, allocated_amount: p.amount,
        utr_reference: p.utr_reference ?? null, received_by: p.received_by ?? null, created_by: caller.id,
      })
    }

    return json({ ok: true, line_items: lineItems.length, payments: payments.length, grand_total: extracted.grand_total ?? null })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('extract-supplier-bill-scan failed for bill', billId, ':', message)
    return json({ error: message }, 500)
  }
})
