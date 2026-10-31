// Carries out an action the search bar proposed, after the user approved it in the UI.
// Every write runs with the caller's own JWT, so Row Level Security and has_permission() decide
// what is allowed; the proposal is re-validated here, not trusted from the browser.
// Supported actions (supplier bills only, for now):
//   create_bill  -- new pending_review bill with supplier, project, date, total and its payments.
//   update_bill  -- change date, total, remarks, supplier or project on a pending_review bill
//   delete_bill  -- hard delete of a bill that is not approved (uses delete_supplier_bill)
// A supplier or project that does not exist is created only when the proposal sets create_supplier
// or create_project; the review shows those in red before the user approves.
// Approved bills are never changed or deleted from here; they must be reversed.
// Line items are not written here; they are added from the Bill Audit Queue.
//
// POST body: { action: { type, ... } }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PAYMENT_MODES = ['cash', 'rtgs_neft', 'credit']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// deno-lint-ignore no-explicit-any
type Action = any

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
  const authHeader = req.headers.get('Authorization') ?? ''

  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const userId = userIdFromToken(authHeader)
  if (!userId) return json({ error: 'Not signed in.' }, 401)
  const { data: active, error: activeError } = await db.rpc('is_active_user')
  if (activeError) return json({ error: 'Not signed in.' }, 401)
  if (!active) return json({ error: 'Your account is not active.' }, 403)
  const user = { id: userId }

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

  // Finds the supplier or project by name, or creates it when the proposal allows it.
  // Returns { record, created } or { error }.
  const resolve = async (table: 'suppliers' | 'design_projects', rawName: string, allowCreate: boolean) => {
    const name = String(rawName ?? '').trim()
    if (!name) return { record: null, created: false }
    const existing = await findByName(table, name)
    if (existing) return { record: existing, created: false }
    if (!allowCreate) {
      return { error: table === 'suppliers'
        ? `No supplier named "${name}". Ask to add it as a new supplier, or add it in Masters first.`
        : `No Design Build project named "${name}".` }
    }
    if (table === 'suppliers') {
      const { data, error } = await db.from('suppliers').insert({ name, created_by: user.id }).select('id, name').single()
      if (error) return { error: error.message }
      return { record: data, created: true }
    }
    const code = `DP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
    const { data, error } = await db.from('design_projects').insert({ code, name, created_by: user.id }).select('id, name').single()
    if (error) return { error: error.message }
    return { record: data, created: true }
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
      const sup = await resolve('suppliers', a.supplier_name, Boolean(a.create_supplier))
      if (sup.error) return json({ error: sup.error }, 400)
      if (!sup.record) return json({ error: 'A supplier name is required.' }, 400)

      let project: { id: string; name: string } | null = null
      let createdProject = false
      if (a.project_name) {
        const proj = await resolve('design_projects', a.project_name, Boolean(a.create_project))
        if (proj.error) return json({ error: proj.error }, 400)
        project = proj.record
        createdProject = proj.created
      }

      const total = money(a.grand_total)
      if (total === null) return json({ error: 'A valid total amount is required.' }, 400)
      const date = validDate(a.bill_date) ?? new Date().toISOString().slice(0, 10)

      const payments = (Array.isArray(a.payments) ? a.payments : []).map((p: Action) => ({
        mode: p?.mode,
        amount: money(p?.amount),
        utr_reference: p?.utr_reference || null,
      }))
      if (payments.some((p: Action) => !PAYMENT_MODES.includes(p.mode) || p.amount === null || p.amount <= 0)) {
        return json({ error: 'Each payment needs a mode (cash, rtgs_neft or credit) and an amount above zero.' }, 400)
      }
      const paid = Math.round(payments.reduce((s: number, p: Action) => s + p.amount, 0) * 100) / 100
      if (payments.length > 0 && Math.abs(paid - total) > 0.01) {
        return json({ error: `The payments add up to ${paid} but the bill total is ${total}. Correct the rows so they match.` }, 400)
      }

      const { data: bill, error } = await db.from('supplier_bills').insert({
        internal_bill_number: `PENDING-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        bill_date: date,
        supplier_id: sup.record.id,
        supplier_text: sup.record.name,
        design_project_id: project?.id ?? null,
        expense_nature: 'material',
        grand_total: total,
        subtotal: total,
        remarks: a.remarks ?? null,
        created_by: user.id,
      }).select('id, internal_bill_number').single()
      if (error) return json({ error: error.message }, 403)

      if (payments.length > 0) {
        const { error: payErr } = await db.from('supplier_bill_payments').insert(
          payments.map((p: Action) => ({ bill_id: bill.id, mode: p.mode, allocated_amount: p.amount, utr_reference: p.utr_reference, created_by: user.id })),
        )
        if (payErr) {
          // Do not leave a bill with half its payments behind.
          await db.rpc('delete_supplier_bill', { p_bill_id: bill.id })
          return json({ error: payErr.message }, 403)
        }
      }
      const added = [
        sup.created ? 'supplier' : '',
        createdProject ? 'project' : '',
      ].filter(Boolean)
      return json({
        ok: true,
        message: `Created bill ${bill.internal_bill_number} for ${sup.record.name}${added.length ? `; new ${added.join(' and ')} added` : ''}. It is in the Bill Audit Queue for review.`,
      })
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
        const s = await resolve('suppliers', a.changes.supplier_name, Boolean(a.create_supplier))
        if (s.error) return json({ error: s.error }, 400)
        changes.supplier_id = s.record.id
        changes.supplier_text = s.record.name
      }
      if (a.changes?.project_name) {
        const p = await resolve('design_projects', a.changes.project_name, Boolean(a.create_project))
        if (p.error) return json({ error: p.error }, 400)
        changes.design_project_id = p.record.id
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

    if (a.type === 'run_sql') {
      // Runs the approved statement as the caller. ai_run_write enforces the guardrails and logs it.
      const { data, error } = await db.rpc('ai_run_write', { p_sql: String(a.sql ?? '') })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, message: `Done. ${data} row${data === 1 ? '' : 's'} changed.` })
    }

    return json({ error: `Unknown action "${a.type}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
