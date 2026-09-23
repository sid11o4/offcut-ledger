import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLeadDesk } from '../lib/useLeadDesk'
import { CLOSED, isoToYmd, today } from '../lib/util'
import Brand from './Brand'
import LeadsList from './LeadsList'
import Pipeline from './Pipeline'
import Followups from './Followups'
import Settings from './Settings'
import LeadDrawer from './LeadDrawer'

const VIEWS = [['list', 'All leads'], ['followups', 'Follow-ups'], ['pipeline', 'Pipeline'], ['settings', 'Settings']]
const EMPTY_F = { q: '', stage: '', project: '', source: '', assigned: '', priority: '' }

const viewFromHash = () => {
  const v = location.hash.slice(1)
  return VIEWS.some(([k]) => k === v) ? v : 'list'
}

function Stats({ leads, go }) {
  const s = useMemo(() => {
    const t = today()
    const active = leads.filter((l) => !CLOSED.has(l.stage))
    const weekAgo = Date.now() - 7 * 86400000
    const due = active.filter((l) => l.next_follow_up && l.next_follow_up <= t)
    const month = t.slice(0, 7)
    return {
      total: leads.length,
      newWeek: leads.filter((l) => Date.parse(l.created_at) >= weekAgo).length,
      untouched: leads.filter((l) => l.stage === 'New').length,
      due: due.length,
      overdue: due.filter((l) => l.next_follow_up < t).length,
      sv: leads.filter((l) => l.stage === 'Site Visit Scheduled').length,
      booked: leads.filter((l) => l.stage === 'Booked').length,
      bookedMonth: leads.filter((l) => l.stage === 'Booked' && isoToYmd(l.booked_at).slice(0, 7) === month).length,
    }
  }, [leads])
  return (
    <section className="stats" aria-label="Summary">
      <button className="stat" type="button" onClick={() => go('list', '')}><div className="lbl">Total leads</div><div className="val">{s.total}</div><div className="sub">{s.newWeek} added this week</div></button>
      <button className={'stat' + (s.untouched ? ' alert' : '')} type="button" onClick={() => go('list', 'New')}><div className="lbl">Not contacted</div><div className="val">{s.untouched}</div><div className="sub">still in New</div></button>
      <button className={'stat' + (s.due ? ' alert' : '')} type="button" onClick={() => go('followups')}><div className="lbl">Follow-ups due</div><div className="val">{s.due}</div><div className="sub">{s.overdue} overdue</div></button>
      <button className="stat" type="button" onClick={() => go('list', 'Site Visit Scheduled')}><div className="lbl">Site visits</div><div className="val">{s.sv}</div><div className="sub">scheduled</div></button>
      <button className="stat" type="button" onClick={() => go('list', 'Booked')}><div className="lbl">Booked</div><div className="val">{s.booked}</div><div className="sub">{s.bookedMonth} this month</div></button>
    </section>
  )
}

export default function Desk({ me, email }) {
  const desk = useLeadDesk()
  const [view, setViewState] = useState(viewFromHash)
  const [f, setF] = useState({ ...EMPTY_F, sort: 'new' })
  const [drawer, setDrawer] = useState(null) // null | { id } | { id: null } for new

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const setView = (v) => {
    setViewState(v)
    history.replaceState(null, '', '#' + v)
  }
  const go = (v, stage) => {
    if (stage !== undefined) setF((x) => ({ ...x, ...EMPTY_F, stage }))
    setView(v)
  }

  const t = today()
  const dueCount = desk.leads.filter((l) => !CLOSED.has(l.stage) && l.next_follow_up && l.next_follow_up <= t).length
  const isAdmin = me.role === 'admin'
  const open = (id) => setDrawer({ id })
  const common = { desk, f, setF, open, clearFilters: () => setF((x) => ({ ...x, ...EMPTY_F })) }

  let body
  if (view === 'settings') body = <Settings desk={desk} me={me} isAdmin={isAdmin} open={open} />
  else if (!desk.ready) body = <div className="loading">Loading leads…</div>
  else if (!desk.leads.length) {
    body = (
      <div className="empty">
        <h2>Your lead desk is ready</h2>
        <p>Every enquiry from Meta ads — WhatsApp chats and lead-form submissions — goes here, so nobody slips through between the first message and the site visit.</p>
        <div className="steps">
          <div className="step"><b>Set up projects & team</b><span>Add the projects you're selling and who handles leads, in Settings.</span></div>
          <div className="step"><b>Log each new lead</b><span>Name, number, project and budget. A phone number can only be added once.</span></div>
          <div className="step"><b>Work your follow-ups</b><span>Set a next follow-up date on every lead; the Follow-ups tab shows who to call today.</span></div>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => setDrawer({ id: null })}>Add first lead</button>
          <button className="btn" type="button" onClick={() => setView('settings')}>Open Settings</button>
        </div>
      </div>
    )
  } else if (view === 'pipeline') body = <Pipeline {...common} />
  else if (view === 'followups') body = <Followups {...common} />
  else body = <LeadsList {...common} />

  return (
    <div className="app">
      <header className="top">
        <Brand />
        <nav className="tabs" role="tablist" aria-label="Views">
          {VIEWS.map(([k, label]) => (
            <button key={k} className="tab" role="tab" type="button" aria-selected={view === k} onClick={() => setView(k)}>
              {label}{k === 'followups' && dueCount > 0 && <span className="count">{dueCount}</span>}
            </button>
          ))}
        </nav>
        <div className="who-menu">
          <span className="who-name" title={email}><b>{me.display_name}</b></span>
          <button className="btn small ghost" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <button className="btn primary" type="button" onClick={() => setDrawer({ id: null })}>
          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 1v12M1 7h12" /></svg>Add lead
        </button>
      </header>
      {desk.loadError && <div className="banner">{desk.loadError}</div>}
      {!desk.live && <div className="offline">Reconnecting to live updates…</div>}
      <Stats leads={desk.leads} go={go} />
      <main>{body}</main>
      {drawer && (
        <LeadDrawer
          key={drawer.id || 'new'}
          id={drawer.id}
          desk={desk}
          isAdmin={isAdmin}
          onOpen={open}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}
