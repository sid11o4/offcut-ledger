// Admin-only user management. The browser can't create/delete auth users or change another
// user's email directly -- those need the service-role key, which must never ship to the
// client. This Edge Function holds that key server-side, verifies the CALLER is an active
// admin (via their own JWT + the has_permission RPC), and then performs the operation.
//
// Actions (POST JSON body): { action, ... }
//   create     { email, password }            -> creates an auth user (email pre-confirmed).
//                                                 handle_new_user() seeds the profile at the
//                                                 least-privileged 'staff' role.
//   delete     { userId }                     -> deletes the auth user (profile cascades).
//   set_email  { userId, email }              -> changes a user's login email.
//
// Self-delete is refused. Deleting or (implicitly) removing the last remaining active admin
// is refused.
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

  // 1. Verify the caller is an active admin, using THEIR token.
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: caller } } = await asCaller.auth.getUser()
  if (!caller) return json({ error: 'Not signed in.' }, 401)
  const { data: allowed, error: permErr } = await asCaller.rpc('has_permission', { perm_key: 'user_manage' })
  if (permErr) return json({ error: permErr.message }, 500)
  if (!allowed) return json({ error: 'You do not have permission to manage users.' }, 403)

  const admin = createClient(url, serviceKey)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body.' }, 400) }
  const action = String(body.action ?? '')

  async function activeAdminCount(): Promise<number> {
    const { count } = await admin
      .from('profiles')
      .select('id, roles!inner(key)', { count: 'exact', head: true })
      .eq('active', true)
      .eq('roles.key', 'admin')
    return count ?? 0
  }

  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!email || password.length < 8) return json({ error: 'Email and a password of at least 8 characters are required.' }, 400)
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, userId: data.user?.id })
  }

  if (action === 'delete') {
    const userId = String(body.userId ?? '')
    if (!userId) return json({ error: 'userId is required.' }, 400)
    if (userId === caller.id) return json({ error: 'You cannot delete your own account.' }, 400)
    const { data: target } = await admin.from('profiles').select('active, roles!inner(key)').eq('id', userId).maybeSingle()
    // deno-lint-ignore no-explicit-any
    const targetIsActiveAdmin = target?.active && (target as any).roles?.key === 'admin'
    if (targetIsActiveAdmin && (await activeAdminCount()) <= 1) {
      return json({ error: 'Cannot delete the last active admin.' }, 400)
    }
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'set_email') {
    const userId = String(body.userId ?? '')
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!userId || !email) return json({ error: 'userId and email are required.' }, 400)
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true })
    if (error) return json({ error: error.message }, 400)
    await admin.from('profiles').update({ email }).eq('id', userId)
    return json({ ok: true })
  }

  return json({ error: `Unknown action "${action}".` }, 400)
})
