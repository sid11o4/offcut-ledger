import { useRef, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { api } from '../lib/useLeadDesk'
import { downloadText, fmtPhone, isoToYmd, metaCsvToLeads, readCsvFile, toCsv, today } from '../lib/util'
import { useToast } from './Toast'

function Projects({ desk, isAdmin }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const active = desk.projects.filter((p) => p.active)
  const archived = desk.projects.filter((p) => !p.active)
  async function add(e) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const existing = archived.find((p) => p.name.toLowerCase() === n.toLowerCase())
    const res = existing ? await api.setProjectActive(existing.id, true) : await api.addProject(n)
    if (!res.ok) return toast(res.error)
    setName('')
    toast('Added ' + n)
    desk.reloadProjects()
  }
  async function archive(p) {
    const res = await api.setProjectActive(p.id, false)
    if (!res.ok) return toast(res.error)
    toast(`${p.name} archived — existing leads keep it`)
    desk.reloadProjects()
  }
  return (
    <div className="panel">
      <h2>Projects</h2>
      <p>Every lead gets tagged to one of these, so you can see demand per project.</p>
      <div className="chips">
        {active.length ? active.map((p) => (
          <span key={p.id} className="chip">{p.name}{isAdmin && <button type="button" aria-label={'Archive ' + p.name} onClick={() => archive(p)}>×</button>}</span>
        )) : <span className="lead-sub">None added yet</span>}
      </div>
      {isAdmin ? (
        <form className="inline-add" onSubmit={add}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scubo Skyville Phase 2" aria-label="New project" maxLength={80} />
          <button className="btn" type="submit">Add</button>
        </form>
      ) : <div className="hint">Only admins can change projects.</div>}
    </div>
  )
}

function Team({ desk, me }) {
  const toast = useToast()
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'agent' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }))

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    const res = await api.manageMembers({ action: 'add', ...form })
    setBusy(false)
    if (!res.ok) return toast(res.error)
    toast(res.data.created ? `Login created for ${form.displayName}` : `${form.displayName} added to the team`)
    setForm({ displayName: '', email: '', password: '', role: 'agent' })
    desk.reloadMembers()
  }
  async function update(m, patch) {
    const res = await api.updateMember(m.user_id, patch)
    if (!res.ok) return toast(res.error)
    desk.reloadMembers()
  }
  async function resetPassword(m) {
    const pw = window.prompt(`New password for ${m.display_name} (at least 8 characters):`)
    if (pw == null) return
    const res = await api.manageMembers({ action: 'set_password', userId: m.user_id, password: pw })
    toast(res.ok ? 'Password changed' : res.error)
  }

  return (
    <div className="panel">
      <h2>Sales team</h2>
      <p>People who can sign in and be assigned leads. Agents can add and work leads; admins can also delete leads and manage projects and the team.</p>
      <ul className="team-list">
        {desk.members.map((m) => (
          <li key={m.user_id} className={m.active ? '' : 'inactive'}>
            <div className="grow"><div className="lead-name">{m.display_name}{m.user_id === me.user_id && ' (you)'}</div><div className="lead-sub">{m.email}</div></div>
            <select aria-label={'Role for ' + m.display_name} value={m.role} onChange={(e) => update(m, { role: e.target.value })}>
              <option value="agent">Agent</option><option value="admin">Admin</option>
            </select>
            {m.user_id !== me.user_id && <button className="btn small" type="button" onClick={() => resetPassword(m)}>Password</button>}
            {m.user_id !== me.user_id && (
              <button className="btn small" type="button" onClick={() => update(m, { active: !m.active })}>{m.active ? 'Remove' : 'Restore'}</button>
            )}
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={add}>
        <div className="row2">
          <input className="field" value={form.displayName} onChange={set('displayName')} placeholder="Name" aria-label="Name" required />
          <select className="field" value={form.role} onChange={set('role')} aria-label="Role"><option value="agent">Agent</option><option value="admin">Admin</option></select>
        </div>
        <input className="field" type="email" value={form.email} onChange={set('email')} placeholder="Email (their login)" aria-label="Email" required />
        <input className="field" type="text" value={form.password} onChange={set('password')} placeholder="Password for a new login (8+ characters)" aria-label="Password" autoComplete="new-password" />
        <div className="hint">If this email already has a Formgrid login, leave the password blank. They'll sign in with their existing password.</div>
        <button className="btn" type="submit" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Adding…' : 'Add to team'}</button>
      </form>
    </div>
  )
}

function ImportCsv({ desk }) {
  const toast = useToast()
  const [msg, setMsg] = useState('')
  const input = useRef(null)
  async function onFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    let text
    try { text = await readCsvFile(file) } catch { return setMsg("Couldn't read that file.") }
    const { rows, error, blank } = metaCsvToLeads(text)
    if (error) return setMsg(error)
    if (!rows.length) return setMsg('No rows with a valid 10-digit phone number.')
    setMsg(`Importing ${rows.length} rows…`)
    let added = 0, skipped = 0
    for (let i = 0; i < rows.length; i += 2000) {
      const res = await api.importLeads(rows.slice(i, i + 2000))
      if (!res.ok) { setMsg(`Stopped after ${added} leads: ${res.error}`); desk.reload(); return }
      added += res.data.added
      skipped += res.data.skipped
    }
    skipped += blank
    setMsg(`Imported ${added} new lead${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate or blank row${skipped === 1 ? '' : 's'}` : ''}.`)
    if (added) toast(`Imported ${added} leads`)
    desk.reload()
  }
  return (
    <div className="panel">
      <h2>Import from Meta</h2>
      <p>In Meta Business Suite → Leads Center (or Ads Manager → Forms library), download leads as CSV and import them here. Numbers already in the lead desk are skipped.</p>
      <button className="btn" type="button" onClick={() => input.current.click()}>Choose CSV file</button>
      <input ref={input} type="file" accept=".csv,text/csv,.tsv" hidden onChange={onFile} />
      {msg && <div className="lead-sub" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  )
}

function ExportCsv({ desk }) {
  const { leads, projectName, memberName } = desk
  function exportCsv() {
    const head = ['Name', 'Phone', 'Email', 'Area', 'Source', 'Project', 'Requirement', 'Budget (Lakhs)', 'Stage', 'Priority', 'Assigned to', 'Next follow-up', 'Not qualified reason', 'Added', 'Last note']
    const rows = leads.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map((l) => [
      l.name, fmtPhone(l.phone), l.email, l.area, l.source, projectName(l.project_id), l.requirement, l.budget_lakhs ?? '',
      l.stage, l.priority, memberName(l.assigned_to), l.next_follow_up || '', l.lost_reason, isoToYmd(l.created_at), l.last_note,
    ])
    downloadText(`scubo-leads-${today()}.csv`, '﻿' + toCsv([head, ...rows]))
  }
  return (
    <div className="panel">
      <h2>Export</h2>
      <p>Download every lead as a CSV spreadsheet — for backup or to open in Excel.</p>
      <button className="btn" type="button" onClick={exportCsv} disabled={!leads.length}>Download {leads.length} leads (.csv)</button>
    </div>
  )
}

function Account() {
  const toast = useToast()
  const [pw, setPw] = useState('')
  async function change(e) {
    e.preventDefault()
    if (pw.length < 8) return toast('Use at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return toast(friendlyError(error))
    setPw('')
    toast('Password changed')
  }
  return (
    <div className="panel">
      <h2>Your password</h2>
      <p>Change the password you sign in with. If you also use Formgrid Factory, this changes it there too.</p>
      <form className="inline-add" onSubmit={change}>
        <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" aria-label="New password" autoComplete="new-password" />
        <button className="btn" type="submit">Change</button>
      </form>
    </div>
  )
}

export default function Settings({ desk, me, isAdmin }) {
  return (
    <div className="settings">
      <Projects desk={desk} isAdmin={isAdmin} />
      {isAdmin && <Team desk={desk} me={me} />}
      <ImportCsv desk={desk} />
      <ExportCsv desk={desk} />
      <Account />
    </div>
  )
}
