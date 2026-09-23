// Scubo Lead Desk: automatic lead intake.
//
// Pabbly Connect ("Facebook Lead Ads → New Lead" trigger, then an API POST action) sends each new
// Meta Instant Form lead here. There is no Supabase login on that side, so this function is
// deployed without JWT verification and instead checks the desk's own intake token (Settings →
// Meta lead import), passed as ?token=… or an `x-leaddesk-token` header.
//
// Accepts either a flat JSON body mapped in Pabbly:
//   { lead_id, created_time, full_name, phone_number, email, city, form_id, form_name,
//     campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, page_id, platform, ...custom }
// or Meta's native lead shape ({ id, created_time, field_data: [{ name, values: [] }], ... }).
// Any key that isn't a known field is stored as a custom form answer.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-leaddesk-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const KNOWN = new Set([
  'lead_id', 'leadgen_id', 'id', 'created_time', 'full_name', 'name', 'first_name', 'last_name',
  'phone_number', 'phone', 'mobile', 'email', 'city', 'form_id', 'form_name', 'campaign_id', 'campaign_name',
  'adset_id', 'adset_name', 'ad_id', 'ad_name', 'page_id', 'platform', 'is_organic', 'field_data', 'token',
])

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const str = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v)).trim()
// Meta CSV exports prefix IDs ("l:123", "ag:456"); the API doesn't. Store the bare ID.
const metaId = (v: unknown) => str(v).replace(/^[a-z]+:/i, '')

// Indian mobile → 10 digits; anything else is kept only as raw text on the lead.
function indianMobile(raw: string) {
  let d = raw.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}

function normalise(body: Record<string, unknown>) {
  const flat: Record<string, unknown> = { ...body }
  if (Array.isArray(body.field_data)) {
    for (const f of body.field_data as { name?: string; values?: unknown[] }[]) {
      if (f?.name) flat[f.name] = f.values ?? ''
    }
  }
  const fullName = str(flat.full_name) || str(flat.name) || [str(flat.first_name), str(flat.last_name)].filter(Boolean).join(' ')
  const rawPhone = str(flat.phone_number) || str(flat.phone) || str(flat.mobile)
  const answers: Record<string, string> = {}
  for (const [k, v] of Object.entries(flat)) {
    if (KNOWN.has(k) || v == null || typeof v === 'object' && !Array.isArray(v)) continue
    const s = str(v)
    if (s) answers[k.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)] = s.slice(0, 500)
  }
  const created = str(flat.created_time)
  const createdMs = created ? (/^\d+$/.test(created) ? Number(created) * 1000 : Date.parse(created)) : NaN
  const platform = str(flat.platform).toLowerCase()
  return {
    meta_lead_id: metaId(flat.lead_id) || metaId(flat.leadgen_id) || metaId(flat.id),
    created_time: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    full_name: fullName.slice(0, 120),
    phone: indianMobile(rawPhone),
    raw_phone: rawPhone || null,
    email: str(flat.email).slice(0, 200),
    city: str(flat.city).slice(0, 120),
    form_id: metaId(flat.form_id), form_name: str(flat.form_name),
    campaign_id: metaId(flat.campaign_id), campaign_name: str(flat.campaign_name),
    adset_id: metaId(flat.adset_id), adset_name: str(flat.adset_name),
    ad_id: metaId(flat.ad_id), ad_name: str(flat.ad_name),
    page_id: metaId(flat.page_id),
    platform: platform === 'instagram' ? 'ig' : platform === 'facebook' ? 'fb' : platform.slice(0, 10),
    answers,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Send leads with POST.' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'leaddesk' },
  })
  const url = new URL(req.url)
  const given = req.headers.get('x-leaddesk-token') ?? url.searchParams.get('token') ?? ''
  const { data: cfg, error: cfgErr } = await db.from('intake_config').select('token').single()
  if (cfgErr || !cfg) return json({ error: 'Intake is not configured.' }, 500)
  if (!given || !safeEqual(given, cfg.token)) return json({ error: 'Invalid or missing token.' }, 401)

  const text = await req.text()
  if (text.length > 64_000) return json({ error: 'Payload too large.' }, 413)
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    body = Array.isArray(parsed) ? parsed[0] : parsed
    if (!body || typeof body !== 'object') throw new Error('not an object')
  } catch {
    await db.from('intake_log').insert({ source: 'pabbly', status: 'rejected', message: 'Body is not JSON', payload: { raw: text.slice(0, 2000) } })
    return json({ error: 'Body must be a JSON object.' }, 400)
  }

  const lead = normalise(body)
  const { data: result, error } = await db.rpc('ingest_meta_lead', { p: lead })
  const status = error ? 'error' : result.status
  const message = error ? error.message : result.message
  await db.from('intake_log').insert({ source: 'pabbly', status, message, lead_id: result?.lead_id ?? null, payload: body })

  // Occasionally drop log rows older than 30 days.
  if (Math.random() < 0.05) {
    await db.from('intake_log').delete().lt('at', new Date(Date.now() - 30 * 86400000).toISOString())
  }

  if (error) return json({ status, message }, 500)
  return json({ status, message, lead_id: result.lead_id ?? null }, status === 'rejected' ? 422 : 200)
})
