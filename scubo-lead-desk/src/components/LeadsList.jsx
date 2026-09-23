import { useMemo } from 'react'
import { CLOSED, PRIORITIES, SOURCES, STAGES, dueCls, filterLeads, fmtBudget, fmtDate, fmtPhone, followLabel, isoToYmd, waLink } from '../lib/util'
import { Options, Prio, StagePill, WaIcon } from './bits'

export default function LeadsList({ desk, f, setF, open, clearFilters }) {
  const { leads, projects, members, projectName, memberName } = desk
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const rows = useMemo(() => filterLeads(leads, f, projectName), [leads, f, projectName])
  const projectOpts = projects.map((p) => ({ value: p.id, label: p.name }))
  const memberOpts = members.map((m) => ({ value: m.user_id, label: m.display_name }))

  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Search name, phone, area, requirement…" value={f.q} onChange={set('q')} aria-label="Search" />
        <select aria-label="Stage" value={f.stage} onChange={set('stage')}><Options list={STAGES} blank="All stages" /></select>
        <select aria-label="Project" value={f.project} onChange={set('project')}><Options list={projectOpts} blank="All projects" /></select>
        <select aria-label="Source" value={f.source} onChange={set('source')}><Options list={SOURCES} blank="All sources" /></select>
        <select aria-label="Assigned to" value={f.assigned} onChange={set('assigned')}><Options list={memberOpts} blank="Anyone" /></select>
        <select aria-label="Priority" value={f.priority} onChange={set('priority')}><Options list={PRIORITIES} blank="Any priority" /></select>
        <select aria-label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="new">Newest first</option>
          <option value="follow">Next follow-up</option>
          <option value="updated">Recently updated</option>
          <option value="budget">Highest budget</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      {!rows.length ? (
        <div className="empty">
          <h2>No leads match</h2>
          <p>Try a different search or clear the filters.</p>
          <div className="actions"><button className="btn" type="button" onClick={clearFilters}>Clear filters</button></div>
        </div>
      ) : (
        <>
          <div className="meta-row"><span>{rows.length} of {leads.length} leads</span></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Lead</th><th>Phone</th><th>Project · Need</th><th>Budget</th><th>Source</th><th>Stage</th><th>Priority</th><th>Owner</th><th>Next follow-up</th><th>Added</th></tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const wa = waLink(l.phone)
                  return (
                    <tr key={l.id} onClick={() => open(l.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(l.id) }}>
                      <td><div className="lead-name">{l.name || 'Unnamed'}</div><div className="lead-sub">{l.area}</div></td>
                      <td>
                        <div className="phone-cell">
                          <span className="mono">{fmtPhone(l.phone)}</span>
                          {wa && <a className="wa-dot" href={wa} target="_blank" rel="noopener noreferrer" title="Open WhatsApp chat" onClick={(e) => e.stopPropagation()}><WaIcon /></a>}
                        </div>
                      </td>
                      <td><div>{projectName(l.project_id) || '—'}</div><div className="lead-sub">{l.requirement}</div></td>
                      <td className="mono">{fmtBudget(l.budget_lakhs)}</td>
                      <td className="lead-sub">{l.source}</td>
                      <td><StagePill stage={l.stage} /></td>
                      <td><Prio p={l.priority} /></td>
                      <td>{memberName(l.assigned_to)}</td>
                      <td><span className={'due ' + dueCls(l.next_follow_up, l.stage)}>{CLOSED.has(l.stage) ? '' : followLabel(l.next_follow_up)}</span></td>
                      <td className="lead-sub mono">{fmtDate(isoToYmd(l.created_at))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
