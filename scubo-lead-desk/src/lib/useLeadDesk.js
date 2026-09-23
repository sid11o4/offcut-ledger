import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const LEAD_COLS = 'id,name,phone,email,area,source,project_id,requirement,budget_lakhs,stage,priority,assigned_to,next_follow_up,lost_reason,booked_at,last_contact_at,last_note,created_at,updated_at'
const PAGE = 1000 // PostgREST's default max-rows

async function fetchAllLeads() {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('leads').select(LEAD_COLS).order('created_at').order('id').range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

// Live copy of the lead desk: leads, projects and team, kept in sync over Supabase Realtime.
// Any change from any device triggers a (debounced) refetch, so every screen agrees.
export function useLeadDesk() {
  const [leads, setLeads] = useState([])
  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [live, setLive] = useState(true)
  const timers = useRef({})
  const wasLive = useRef(true)

  const loadLeads = useCallback(async () => {
    try {
      setLeads(await fetchAllLeads())
      setLoadError('')
    } catch (e) {
      setLoadError(friendlyError(e))
    }
  }, [])
  const loadProjects = useCallback(async () => {
    const { data, error } = await supabase.from('projects').select('id,name,active').order('name')
    if (!error) setProjects(data)
  }, [])
  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.from('members').select('user_id,display_name,email,role,active').order('display_name')
    if (!error) setMembers(data)
  }, [])

  const debounced = useCallback((key, fn) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(fn, 250)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadLeads(), loadProjects(), loadMembers()]).then(() => { if (!cancelled) setReady(true) })

    const channel = supabase
      .channel('leaddesk-live')
      .on('postgres_changes', { event: '*', schema: 'leaddesk', table: 'leads' }, () => debounced('leads', loadLeads))
      .on('postgres_changes', { event: '*', schema: 'leaddesk', table: 'projects' }, () => debounced('projects', loadProjects))
      .on('postgres_changes', { event: '*', schema: 'leaddesk', table: 'members' }, () => debounced('members', loadMembers))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Catch anything missed while disconnected.
          if (!wasLive.current) { loadLeads(); loadProjects(); loadMembers() }
          wasLive.current = true
          setLive(true)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasLive.current = false
          setLive(false)
        }
      })

    // Tabs left open all day: refresh on return so stale data never lingers.
    const onVisible = () => { if (document.visibilityState === 'visible') { loadLeads(); loadProjects(); loadMembers() } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    const t = timers.current
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      Object.values(t).forEach(clearTimeout)
    }
  }, [loadLeads, loadProjects, loadMembers, debounced])

  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]))
    return (id) => (id ? m.get(id) || '' : '')
  }, [projects])
  const memberName = useMemo(() => {
    const m = new Map(members.map((p) => [p.user_id, p.display_name]))
    return (id) => (id ? m.get(id) || '' : '')
  }, [members])

  return { leads, projects, members, ready, loadError, live, projectName, memberName, reload: loadLeads, reloadProjects: loadProjects, reloadMembers: loadMembers }
}

// ---- writes: each returns { ok, error } with a friendly message ----
async function run(promise) {
  const { data, error } = await promise
  return error ? { ok: false, error: friendlyError(error) } : { ok: true, data }
}

export const api = {
  async createLead(fields, firstNote) {
    const res = await run(supabase.from('leads').insert(fields).select('id').single())
    if (!res.ok) return res
    const acts = [{ lead_id: res.data.id, type: 'created', text: `Lead added · ${fields.source || 'Unknown source'}` }]
    if (firstNote) acts.push({ lead_id: res.data.id, type: 'note', text: firstNote })
    await run(supabase.from('activities').insert(acts))
    return res
  },
  updateLead: (id, patch) => run(supabase.from('leads').update(patch).eq('id', id).select('id').single()),
  deleteLead: (id) => run(supabase.from('leads').delete().eq('id', id).select('id').single()),
  addActivity: (lead_id, type, text) => run(supabase.from('activities').insert({ lead_id, type, text })),
  listActivities: (lead_id) => run(supabase.from('activities').select('id,type,text,at').eq('lead_id', lead_id).order('at', { ascending: false }).order('id')),
  importLeads: (rows) => run(supabase.rpc('import_leads', { p_rows: rows }).single()),
  addProject: (name) => run(supabase.from('projects').insert({ name })),
  setProjectActive: (id, active) => run(supabase.from('projects').update({ active }).eq('id', id)),
  updateMember: (user_id, patch) => run(supabase.from('members').update(patch).eq('user_id', user_id)),
  async manageMembers(body) {
    const { data, error } = await supabase.functions.invoke('leaddesk-members', { body })
    if (error) {
      let msg = error.message
      try { msg = (await error.context.json()).error || msg } catch { /* not JSON */ }
      return { ok: false, error: friendlyError({ message: msg }) }
    }
    return { ok: true, data }
  },
}
