// Scubo Lead Desk team management. Creating logins needs the service-role key, which
// must never reach the browser, so it lives here. The caller must be an active lead desk
// admin (checked with THEIR token via leaddesk.is_admin()).
//
// The lead desk shares auth.users with Formgrid Factory. Formgrid's handle_new_user()
// trigger gives every new login an active 'staff' Formgrid profile, so accounts created
// here have that profile switched off: a sales agent must not get into the factory app.
//
// Actions (POST JSON): { action, ... }
//   add           { email, displayName, role, password? }
//                   Existing login (e.g. a Formgrid user): just grants lead desk access.
//                   New login: password (8+ chars) required; account is created confirmed.
//   set_password  { userId, password }
//                   Only for lead-desk-only accounts (no active Formgrid profile), so a
//                   lead desk admin can never take over a factory login.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    db: { schema: 'leaddesk' },
  })
  const { data: { user: caller } } = await asCaller.auth.getUser()
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: isAdmin, error: permErr } = await asCaller.rpc('is_admin')
  if (permErr) return json({ error: permErr.message }, 500)
  if (!isAdmin) return json({ error: 'Only a lead desk admin can manage the team.' }, 403)

  const admin = createClient(url, serviceKey)
  const ld = createClient(url, serviceKey, { db: { schema: 'leaddesk' } })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const action = String(body.action ?? '')

  async function findUserByEmail(email: string) {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
      if (hit) return hit
      if (data.users.length < 200) return null
    }
    return null
  }

  if (action === 'add') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const displayName = String(body.displayName ?? '').trim()
    const role = body.role === 'admin' ? 'admin' : 'agent'
    const password = String(body.password ?? '')
    if (!email || !displayName) return json({ error: 'Name and email are required.' }, 400)

    let userId: string
    let created = false
    const existing = await findUserByEmail(email)
    if (existing) {
      userId = existing.id
    } else {
      if (password.length < 8) {
        return json({ error: 'No login exists for this email yet. Set a password of at least 8 characters to create one.' }, 400)
      }
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: displayName, app: 'leaddesk' },
      })
      if (error || !data.user) return json({ error: error?.message ?? 'Could not create the login.' }, 400)
      userId = data.user.id
      created = true
      // Keep new sales logins out of Formgrid Factory.
      await admin.from('profiles').update({ active: false }).eq('id', userId)
    }

    const { error } = await ld.from('members').upsert(
      { user_id: userId, display_name: displayName, email, role, active: true },
      { onConflict: 'user_id' },
    )
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, userId, created })
  }

  if (action === 'set_password') {
    const userId = String(body.userId ?? '')
    const password = String(body.password ?? '')
    if (!userId || password.length < 8) return json({ error: 'A password of at least 8 characters is required.' }, 400)
    const { data: member } = await ld.from('members').select('user_id').eq('user_id', userId).maybeSingle()
    if (!member) return json({ error: 'That person is not on the lead desk team.' }, 404)
    const { data: profile } = await admin.from('profiles').select('active').eq('id', userId).maybeSingle()
    if (profile?.active) {
      return json({ error: 'This login is also used for Formgrid Factory. Change its password from there.' }, 403)
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: `Unknown action "${action}".` }, 400)
})
