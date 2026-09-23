import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/useLeadDesk'
import { CLOSED, LOG_CHIPS, PRIORITIES, SOURCES, STAGES, addDays, fmtPhone, fmtWhen, normPhone, today, waLink } from '../lib/util'
import { Options, WaIcon } from './bits'
import { useToast } from './Toast'

const FIELDS = ['name', 'phone', 'email', 'area', 'source', 'project_id', 'requirement', 'budget_lakhs', 'stage', 'priority', 'assigned_to', 'next_follow_up', 'lost_reason']

// Lead row -> form strings.
function toForm(l) {
  return {
    name: l.name || '', phone: l.phone ? fmtPhone(l.phone) : '', email: l.email || '', area: l.area || '',
    source: l.source || '', project_id: l.project_id || '', requirement: l.requirement || '',
    budget_lakhs: l.budget_lakhs == null ? '' : String(Number(l.budget_lakhs)), stage: l.stage || 'New',
    priority: l.priority || '', assigned_to: l.assigned_to || '', next_follow_up: l.next_follow_up || '', lost_reason: l.lost_reason || '',
  }
}
// Form strings -> column values.
function fromForm(v) {
  return {
    name: v.name.trim(), phone: normPhone(v.phone), email: v.email.trim(), area: v.area.trim(), source: v.source,
    project_id: v.project_id || null, requirement: v.requirement.trim(),
    budget_lakhs: v.budget_lakhs.trim() === '' ? null : Number(v.budget_lakhs), stage: v.stage, priority: v.priority,
    assigned_to: v.assigned_to || null, next_follow_up: v.next_follow_up || null,
    lost_reason: v.stage === 'Not Qualified' ? v.lost_reason.trim() : '',
  }
}

export default function LeadDrawer({ id, desk, isAdmin, onOpen, onClose }) {
  const { leads, projects, members, reload } = desk
  const toast = useToast()
  const lead = id ? leads.find((l) => l.id === id) : null
  const isNew = !id

  // Snapshot of the lead as opened: saving sends only fields the user changed, so edits
  // someone else made meanwhile (other fields) aren't overwritten.
  const [initial, setInitial] = useState(() => toForm(lead || { stage: 'New', priority: 'Warm', source: 'Meta – Lead form', next_follow_up: today() }))
  const [v, setV] = useState(initial)
  const [note, setNote] = useState('')
  const [firstNote, setFirstNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [acts, setActs] = useState(null)
  const nameRef = useRef(null)

  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const dirty = FIELDS.some((k) => v[k] !== initial[k]) || firstNote.trim() !== ''

  const close = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes to this lead?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => { if (isNew) setTimeout(() => nameRef.current?.focus(), 30) }, [isNew])

  // Deleted by someone else while open.
  const vanished = !isNew && desk.ready && !lead
  useEffect(() => { if (vanished) { toast('This lead was deleted'); onClose() } }, [vanished, toast, onClose])

  // Timeline: reload whenever the lead changes (new activity bumps updated_at).
  const loadActs = useCallback(async () => {
    if (!id) return
    const res = await api.listActivities(id)
    if (res.ok) setActs(res.data)
  }, [id])
  useEffect(() => { loadActs() }, [loadActs, lead?.updated_at])

  const dup = useMemo(() => {
    const ph = normPhone(v.phone)
    return ph.length === 10 ? leads.find((l) => l.phone === ph && l.id !== id) : null
  }, [v.phone, leads, id])

  if (!isNew && !lead) return null

  // Keep options for values that were removed from Settings but are still on this lead.
  const projectOpts = projects.filter((p) => p.active || p.id === v.project_id).map((p) => ({ value: p.id, label: p.name }))
  const memberOpts = members.filter((m) => m.active || m.user_id === v.assigned_to).map((m) => ({ value: m.user_id, label: m.display_name }))
  const sourceOpts = SOURCES.includes(v.source) || !v.source ? SOURCES : [...SOURCES, v.source]
  const wa = lead ? waLink(lead.phone) : null

  async function save(e) {
    e?.preventDefault()
    const digits = normPhone(v.phone)
    if (!v.name.trim() && !digits) return setErr('Add at least a name or phone number.')
    if (digits && digits.length !== 10) return setErr('Enter a 10-digit mobile number.')
    if (v.budget_lakhs.trim() !== '' && !(Number(v.budget_lakhs) >= 0)) return setErr('Budget must be a number in lakhs.')
    if (dup) return setErr('This number is already in the lead desk. Open the existing lead instead.')
    setErr('')
    setBusy(true)
    const cols = fromForm(v)
    let res
    if (isNew) {
      res = await api.createLead(cols, firstNote.trim())
    } else {
      const before = fromForm(initial)
      const patch = {}
      for (const k of FIELDS) if (JSON.stringify(cols[k]) !== JSON.stringify(before[k])) patch[k] = cols[k]
      if (patch.stage && patch.stage !== 'Not Qualified') delete patch.lost_reason
      if (v.stage === 'Not Qualified' && v.lost_reason !== initial.lost_reason) patch.lost_reason = cols.lost_reason
      res = Object.keys(patch).length ? await api.updateLead(id, patch) : { ok: true }
    }
    setBusy(false)
    if (!res.ok) return setErr(res.error)
    toast(isNew ? `${cols.name || 'Lead'} saved` : 'Saved')
    await reload()
    onClose()
  }

  async function logActivity(text) {
    const cur = lead.stage
    let stage = null
    if (text === 'Site visit done' && !CLOSED.has(cur) && STAGES.indexOf(cur) < STAGES.indexOf('Site Visit Done')) stage = 'Site Visit Done'
    else if (cur === 'New' && text !== 'Called – no answer') stage = 'Contacted'
    const res = await api.addActivity(id, 'log', text)
    if (!res.ok) return toast(res.error)
    if (stage) {
      const r2 = await api.updateLead(id, { stage })
      if (!r2.ok) return toast(r2.error)
      // Reflect the automatic stage move in the form unless the user already changed it.
      if (v.stage === initial.stage) { setV((x) => ({ ...x, stage })); setInitial((x) => ({ ...x, stage })) }
    }
    toast('Logged')
    reload()
    loadActs()
  }

  async function addNote() {
    const text = note.trim()
    if (!text) return
    const res = await api.addActivity(id, 'note', text)
    if (!res.ok) return toast(res.error)
    setNote('')
    toast('Note added')
    reload()
    loadActs()
  }

  async function del() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    const res = await api.deleteLead(id)
    if (!res.ok) return toast(res.error)
    toast(`${lead.name || 'Lead'} deleted`)
    onClose()
    reload()
  }

  async function copyNum() {
    try { await navigator.clipboard.writeText('+91' + lead.phone); toast('Number copied') } catch { toast('Copy failed — select the number instead') }
  }

  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle">
        <div className="d-head">
          <div>
            <h2 id="dTitle">{lead ? lead.name || 'Unnamed' : 'New lead'}</h2>
            <div className="sub">{lead ? `Added ${fmtWhen(lead.created_at)}${lead.source ? ' · ' + lead.source : ''}` : 'From a Meta form, WhatsApp chat, call or walk-in'}</div>
          </div>
          <button className="btn ghost x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        <div className="d-body">
          {lead && lead.phone && (
            <div className="contact-bar">
              <span className="num">{fmtPhone(lead.phone)}</span>
              <button className="btn small" type="button" onClick={copyNum}>Copy</button>
              <a className="btn small" href={'tel:+91' + lead.phone}>Call</a>
              {wa && <a className="btn small wa" href={wa} target="_blank" rel="noopener noreferrer"><WaIcon width="13" height="13" />WhatsApp</a>}
            </div>
          )}
          <form className="form" onSubmit={save} noValidate>
            <label>Name<input ref={nameRef} className="field" value={v.name} onChange={set('name')} autoComplete="off" maxLength={120} /></label>
            <label>Phone<input className="field mono" inputMode="tel" value={v.phone} onChange={set('phone')} placeholder="98765 43210" autoComplete="off" /></label>
            {dup && (
              <div className="full">
                <div className="dup">
                  <span>This number is already in the lead desk: <b>{dup.name || 'Unnamed'}</b> · {dup.stage}</span>
                  <button className="btn small" type="button" onClick={() => onOpen(dup.id)}>Open existing</button>
                </div>
              </div>
            )}
            <label>Email <span className="opt">optional</span><input className="field" type="email" value={v.email} onChange={set('email')} /></label>
            <label>Area / city<input className="field" value={v.area} onChange={set('area')} placeholder="e.g. Karur, Thanthonimalai" /></label>
            <label>Source<select className="field" value={v.source} onChange={set('source')}><Options list={sourceOpts} blank="—" /></select></label>
            <label>Project<select className="field" value={v.project_id} onChange={set('project_id')}><Options list={projectOpts} blank="— Not decided —" /></select></label>
            <label>Requirement<input className="field" value={v.requirement} onChange={set('requirement')} placeholder="3 BHK, east-facing" /></label>
            <label>Budget (₹ lakhs)<input className="field mono" type="number" min="0" step="0.5" inputMode="decimal" value={v.budget_lakhs} onChange={set('budget_lakhs')} placeholder="85" /></label>
            <label>Stage<select className="field" value={v.stage} onChange={set('stage')}><Options list={STAGES} /></select></label>
            <label>Priority<select className="field" value={v.priority} onChange={set('priority')}><Options list={PRIORITIES} blank="—" /></select></label>
            <label>Assigned to<select className="field" value={v.assigned_to} onChange={set('assigned_to')}><Options list={memberOpts} blank="Unassigned" /></select></label>
            <label>Next follow-up
              <input className="field mono" type="date" value={v.next_follow_up} onChange={set('next_follow_up')} />
              <span className="quick-dates">
                {[['Today', 0], ['+1d', 1], ['+3d', 3], ['+1w', 7]].map(([lbl, n]) => (
                  <button key={lbl} className="btn small" type="button" onClick={() => setV((x) => ({ ...x, next_follow_up: addDays(today(), n) }))}>{lbl}</button>
                ))}
                <button className="btn small ghost" type="button" onClick={() => setV((x) => ({ ...x, next_follow_up: '' }))}>Clear</button>
              </span>
            </label>
            {v.stage === 'Not Qualified' && (
              <label className="full">Why not qualified<input className="field" value={v.lost_reason} onChange={set('lost_reason')} placeholder="Budget mismatch, wrong location, not reachable, just browsing…" /></label>
            )}
            {isNew && (
              <label className="full">First note <span className="opt">optional</span>
                <textarea className="field" value={firstNote} onChange={(e) => setFirstNote(e.target.value)} placeholder="What did they ask? e.g. Wants 3 BHK ready by March, asked about car parking" />
              </label>
            )}
            {err && <div className="full err">{err}</div>}
            <button type="submit" hidden />
          </form>

          {lead && (
            <>
              <div className="section-t">Log activity</div>
              <div className="log-chips">
                {LOG_CHIPS.map((c) => <button key={c} className="btn small" type="button" onClick={() => logActivity(c)}>{c}</button>)}
              </div>
              <div className="note-add">
                <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note — what was discussed, objections, next step" />
                <button className="btn" type="button" onClick={addNote} disabled={!note.trim()}>Add note</button>
              </div>
              <ul className="timeline">
                {acts === null ? <li><span /><div className="lead-sub">Loading…</div></li>
                  : acts.length ? acts.map((a) => (
                    <li key={a.id} className={'t-' + a.type}><span className="dot" /><div><div className="when">{fmtWhen(a.at)}</div><div className="what">{a.text}</div></div></li>
                  )) : <li><span /><div className="lead-sub">No activity yet</div></li>}
              </ul>
            </>
          )}
        </div>
        <div className="d-foot">
          {lead && isAdmin && (
            <button className={'btn danger' + (armed ? ' armed' : '')} type="button" onClick={del}>{armed ? 'Tap again to delete' : 'Delete'}</button>
          )}
          <span className="spacer" />
          <button className="btn" type="button" onClick={close}>{lead ? 'Close' : 'Cancel'}</button>
          <button className="btn primary" type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : lead ? 'Save changes' : 'Save lead'}</button>
        </div>
      </aside>
    </>
  )
}
