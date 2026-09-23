import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

// All lead desk tables live in the `leaddesk` schema of the shared formgrid-factory project.
export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'scubo-lead-desk-auth' },
      db: { schema: 'leaddesk' },
    })
  : null

// Map a PostgREST / Postgres error to something a sales agent can act on.
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (error.code === '23505' && /leads_phone_uq/.test(msg)) return 'This phone number is already in the lead desk.'
  if (error.code === '23505' && /projects_name_uq/.test(msg)) return 'That project is already in the list.'
  if (error.code === '42501' || /row-level security/i.test(msg)) return "You don't have permission to do that."
  if (error.code === 'PGRST106' || /schema must be one of/i.test(msg)) {
    return 'The leaddesk schema is not exposed in Supabase yet (Settings → Data API → Exposed schemas).'
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Couldn't reach the server. Check your connection and try again."
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Your session expired. Reload the page and sign in again.'
  return msg
}
