import { api } from '../lib/useLeadDesk'
import { CLOSED, addDays, dueCls, fmtBudget, fmtDate, fmtPhone, followLabel, today, waLink } from '../lib/util'
import { Options, StagePill, WaIcon } from './bits'
import { useToast } from './Toast'

export default function Followups({ desk, f, setF, open }) {
  const { leads, members, projectName, memberName, reload } = desk
  const toast = useToast()
  const t = today()
  const in7 = addDays(t, 7)
  const active = leads.filter((l) => !CLOSED.has(l.stage) && (!f.assigned || l.assigned_to === f.assigned))
  const groups = [
    ['overdue', 'Overdue', active.filter((l) => l.next_follow_up && l.next_follow_up < t)],
    ['today', 'Today', active.filter((l) => l.next_follow_up === t)],
    ['week', 'Next 7 days', active.filter((l) => l.next_follow_up && l.next_follow_up > t && l.next_follow_up <= in7)],
    ['later', 'Later', active.filter((l) => l.next_follow_up && l.next_follow_up > in7)],
    ['none', 'No follow-up date set', active.filter((l) => !l.next_follow_up)],
  ]

  async function snooze(l, days) {
    const nd = addDays(t, days)
    const res = await api.updateLead(l.id, { next_follow_up: nd })
    if (res.ok) { toast(`Follow-up moved to ${fmtDate(nd)}`); reload() } else toast(res.error)
  }

  return (
    <>
      <div className="filters">
        <select aria-label="Assigned to" value={f.assigned} onChange={(e) => setF((x) => ({ ...x, assigned: e.target.value }))}>
          <Options list={members.map((m) => ({ value: m.user_id, label: m.display_name }))} blank="Everyone" />
        </select>
      </div>
      {!active.length ? (
        <div className="empty"><h2>No open leads</h2><p>Every lead{f.assigned ? ' for ' + memberName(f.assigned) : ''} is either booked or marked not qualified.</p></div>
      ) : groups.filter((g) => g[2].length).map(([k, title, items]) => {
        items.sort((x, y) => (x.next_follow_up || '').localeCompare(y.next_follow_up || '') || (x.created_at || '').localeCompare(y.created_at || ''))
        return (
          <section key={k} className={'fu-group ' + k}>
            <h3>{title}<span className="n">{items.length}</span></h3>
            <div className="fu-list">
              {items.map((l) => {
                const wa = waLink(l.phone)
                return (
                  <div key={l.id} className="fu-item">
                    <div className="who" onClick={() => open(l.id)}>
                      <div className="lead-name">{l.name || 'Unnamed'} <span className="mono lead-sub">{fmtPhone(l.phone)}</span></div>
                      <div className="lead-sub">
                        <StagePill stage={l.stage} /> {[projectName(l.project_id), fmtBudget(l.budget_lakhs)].filter(Boolean).join(' · ')}
                        {l.assigned_to ? ' · ' + memberName(l.assigned_to) : ''}
                        {l.next_follow_up && <> · <span className={'due ' + dueCls(l.next_follow_up, l.stage)}>{followLabel(l.next_follow_up)}</span></>}
                      </div>
                    </div>
                    <div className="last">{l.last_note || <span className="lead-sub">No notes yet</span>}</div>
                    <div className="acts">
                      {wa && <a className="btn small wa" href={wa} target="_blank" rel="noopener noreferrer"><WaIcon width="13" height="13" />WhatsApp</a>}
                      <button className="btn small" type="button" onClick={() => snooze(l, 1)}>+1 day</button>
                      <button className="btn small" type="button" onClick={() => snooze(l, 3)}>+3 days</button>
                      <button className="btn small" type="button" onClick={() => open(l.id)}>Open</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}
