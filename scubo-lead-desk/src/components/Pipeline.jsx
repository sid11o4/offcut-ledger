import { useState } from 'react'
import { api } from '../lib/useLeadDesk'
import { CLOSED, STAGES, dueCls, fmtBudget, followLabel } from '../lib/util'
import { Options, Prio, StagePill } from './bits'
import { useToast } from './Toast'

export default function Pipeline({ desk, f, setF, open }) {
  const { leads, projects, members, projectName, reload } = desk
  const toast = useToast()
  const [over, setOver] = useState(null)
  const [pending, setPending] = useState({}) // id -> stage while the move is saving
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const shown = leads
    .filter((l) => (!f.project || l.project_id === f.project) && (!f.assigned || l.assigned_to === f.assigned))
    .map((l) => (pending[l.id] ? { ...l, stage: pending[l.id] } : l))

  async function move(id, stage) {
    const l = leads.find((x) => x.id === id)
    if (!l || l.stage === stage) return
    setPending((p) => ({ ...p, [id]: stage }))
    const res = await api.updateLead(id, { stage })
    if (res.ok) {
      toast(`${l.name || 'Lead'} → ${stage}`)
      await reload()
    } else toast(res.error)
    setPending((p) => { const n = { ...p }; delete n[id]; return n })
  }

  return (
    <>
      <div className="filters">
        <select aria-label="Project" value={f.project} onChange={set('project')}><Options list={projects.map((p) => ({ value: p.id, label: p.name }))} blank="All projects" /></select>
        <select aria-label="Assigned to" value={f.assigned} onChange={set('assigned')}><Options list={members.map((m) => ({ value: m.user_id, label: m.display_name }))} blank="Anyone" /></select>
        <span className="lead-sub hide-sm">Drag a card to move it to another stage</span>
      </div>
      <div className="board-wrap">
        <div className="board">
          {STAGES.map((st) => {
            const items = shown.filter((l) => l.stage === st).sort((x, y) => (x.next_follow_up || '9999').localeCompare(y.next_follow_up || '9999'))
            return (
              <div
                key={st}
                className={'col' + (over === st ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOver(st) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null) }}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, st) }}
              >
                <div className="col-head"><StagePill stage={st} /><span className="n">{items.length}</span></div>
                {items.map((l) => (
                  <div
                    key={l.id}
                    className="card"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move' }}
                    onClick={() => open(l.id)}
                  >
                    <div className="row"><span className="lead-name">{l.name || 'Unnamed'}</span><Prio p={l.priority} /></div>
                    <div className="lead-sub">{[projectName(l.project_id), l.requirement].filter(Boolean).join(' · ') || 'No project'}</div>
                    <div className="row">
                      <span className="mono lead-sub">{fmtBudget(l.budget_lakhs)}</span>
                      <span className={'due ' + dueCls(l.next_follow_up, l.stage)}>{CLOSED.has(l.stage) ? '' : followLabel(l.next_follow_up)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
