// Carries out an action the search bar proposed, after the user approved it in the UI.
// Every write runs with the caller's own JWT, so Row Level Security and has_permission() decide
// what is allowed; the proposal is re-validated here, not trusted from the browser.
// Supported actions (supplier bills only, for now):
//   create_bill  -- new pending_review bill with supplier, project, date, total and optional payment
//   update_bill  -- change date, total, remarks, supplier or project on a pending_review bill
//   delete_bill  -- hard delete of a bill that is not approved (uses delete_supplier_bill)
// Approved bills are never changed or deleted from here; they must be reversed.
//
// POST body: { action: { type, ... } }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// deno-lint-ignore no-explicit-any
type Action = any

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await db.auth.getUser()
  if (!user) return json({ error: 'Not signed in.' }, 401)
  const { data: active } = await db.rpc('is_active_user')
  if (!active) return json({ error: 'Your account is not active.' }, 403)

  let body: { action?: Action }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const a: Action = body.action
  if (!a || typeof a !== 'object') return json({ error: 'No action supplied.' }, 400)

  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
  const money = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
  }
  const validDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

  // Name lookups go through RLS, so a user only matches records they can see.
  const findByName = async (table: 'suppliers' | 'design_projects', name: string) => {
    if (!name) return null
    let q = db.from(table).select('id, name').limit(500)
    // suppliers has an active flag; design_projects does not
    if (table === 'suppliers') q = q.eq('active', true)
    const { data } = await q
    return (data ?? []).find((r: { name: string }) => norm(r.name) === norm(name)) ?? null
  }

  const findBill = async (billNumber: string) => {
    const { data } = await db.from('supplier_bills').select('id, status, internal_bill_number')
      .eq('internal_bill_number', billNumber).limit(2)
    if (!data || data.length === 0) return { error: `No bill numbered ${billNumber} that you can see.` }
    if (data.length > 1) return { error: `More than one bill is numbered ${billNumber}. Use the Bill Audit Queue to choose.` }
    return { bill: data[0] }
  }

  try {
    if (a.type === 'create_bill') {
      const supplier = await findByName('suppliers', a.supplier_name)
      const project = a.project_name ? await findByName('design_projects', a.project_name) : null
      if (!supplier) return json({ error: `No supplier named "${a.supplier_name}". Add the supplier in Masters first.` }, 400)
      if (a.project_name && !project) return json({ error: `No Design Build project named "${a.project_name}".` }, 400)
      const total = money(a.grand_total)
      if (total === null) return json({ error: 'A valid total amount is required.' }, 400)
      const date = validDate(a.bill_date) ?? new Date().toISOString().slice(0, 10)

      const { data: bill, error } = await db.from('supplier_bills').insert({
        internal_bill_number: `PENDING-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        bill_date: date,
        supplier_id: supplier.id,
        supplier_text: a.supplier_name,
        design_project_id: project?.id ?? null,
        expense_nature: 'material',
        grand_total: total,
        subtotal: total,
        remarks: a.remarks ?? null,
        created_by: user.id,
      }).select('id, internal_bill_number').single()
      if (error) return json({ error: error.message }, 403)

      const mode = a.payment_mode
      if (mode && ['cash', 'rtgs_neft', 'credit'].includes(mode)) {
        const amount = money(a.payment_amount) ?? total
        const { error: payErr } = await db.from('supplier_bill_payments').insert({
          bill_id: bill.id, mode, allocated_amount: amount, created_by: user.id,
          utr_reference: a.utr_reference ?? null,
        })
        if (payErr) return json({ error: payErr.message }, 403)
      }
      return json({ ok: true, message: `Created bill ${bill.internal_bill_number} for ${a.supplier_name}. It is in the Bill Audit Queue for review.` })
    }

    if (a.type === 'update_bill') {
      const found = await findBill(String(a.bill_number ?? ''))
      if (found.error) return json({ error: found.error }, 404)
      if (found.bill.status === 'approved') return json({ error: 'That bill is approved and cannot be changed here.' }, 400)
      const changes: Record<string, unknown> = {}
      if (a.changes?.bill_date) {
        const d = validDate(a.changes.bill_date)
        if (!d) return json({ error: 'Bill date must be YYYY-MM-DD.' }, 400)
        changes.bill_date = d
      }
      if (a.changes?.grand_total !== undefined) {
        const t = money(a.changes.grand_total)
        if (t === null) return json({ error: 'Total must be a positive amount.' }, 400)
        changes.grand_total = t
      }
      if (a.changes?.remarks !== undefined) changes.remarks = String(a.changes.remarks)
      if (a.changes?.supplier_name) {
        const s = await findByName('suppliers', a.changes.supplier_name)
        if (!s) return json({ error: `No supplier named "${a.changes.supplier_name}".` }, 400)
        changes.supplier_id = s.id
        changes.supplier_text = a.changes.supplier_name
      }
      if (a.changes?.project_name) {
        const p = await findByName('design_projects', a.changes.project_name)
        if (!p) return json({ error: `No Design Build project named "${a.changes.project_name}".` }, 400)
        changes.design_project_id = p.id
      }
      if (Object.keys(changes).length === 0) return json({ error: 'Nothing to change.' }, 400)
      const { error } = await db.from('supplier_bills').update(changes).eq('id', found.bill.id)
      if (error) return json({ error: error.message }, 403)
      return json({ ok: true, message: `Updated bill ${a.bill_number}.` })
    }

    if (a.type === 'delete_bill') {
      const found = await findBill(String(a.bill_number ?? ''))
      if (found.error) return json({ error: found.error }, 404)
      const { error } = await db.rpc('delete_supplier_bill', { p_bill_id: found.bill.id })
      if (error) return json({ error: error.message }, 403)
      return json({ ok: true, message: `Deleted bill ${a.bill_number}.` })
    }

    return json({ error: `Unknown action "${a.type}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
