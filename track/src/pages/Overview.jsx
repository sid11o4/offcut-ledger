import { useEffect, useState } from 'react'
import { Bar, Empty, Loading } from '../components/ui'
import { pct, statusLabel, localDateKey } from '../lib/progress'
import { getReport, listRequests } from '../lib/api'

export default function Overview({ project, data, go }) {
  const { summary, plan, loading, error } = data
  const [today, setToday] = useState(undefined)
  const [open, setOpen] = useState(0)

  useEffect(() => {
    if (!project) return
    let live = true
    getReport(project.id, localDateKey()).then((r) => live && setToday(r)).catch(() => live && setToday(null))
    listRequests(project.id).then((r) => live && setOpen(r.filter((x) => ['requested', 'approved'].includes(x.status)).length)).catch(() => {})
    return () => { live = false }
  }, [project])

  if (!project) return <Empty>No project yet. An admin can create one under Admin.</Empty>
  if (loading) return <Loading />
  if (error) return <div className="notice">{error}</div>

  const itemCount = plan.items.length
  return (
    <div className="stack">
      <section className="card">
        <p className="muted small" style={{ margin: 0 }}>{[project.client_name, project.location].filter(Boolean).join(' · ') || 'Overall progress'}</p>
        <div className="hero" style={{ marginTop: 6 }}>
          <div className="hero-num">{pct(summary.overall)}</div>
          <div><span className="pill pill-brand">{statusLabel(summary.overall)}</span><p className="muted small" style={{ margin: '6px 0 0' }}>{summary.rooms.length} rooms · {itemCount} BOQ items</p></div>
        </div>
        <div style={{ marginTop: 14 }}><Bar value={summary.overall} large /></div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2>Today</h2><span className="spacer" />
            {today === undefined ? null : today?.closed_at ? <span className="pill pill-ok">Closed</span> : today ? <span className="pill pill-brand">In progress</span> : <span className="pill pill-warn">Not started</span>}
          </div>
          {today?.closed_at && <p style={{ margin: 0 }}>Moved <b className="tnum">{pct((today.end_pct ?? 0) - today.start_pct)}</b> today, to <b className="tnum">{pct(today.end_pct)}</b>.</p>}
          {today && !today.closed_at && <p style={{ margin: 0 }}>Day started at <b className="tnum">{pct(today.start_pct)}</b>.</p>}
          {today === null && <p className="muted" style={{ margin: 0 }}>No day started yet.</p>}
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => go('log')}>Open site log</button>
        </section>
        <section className="card">
          <div className="card-head"><h2>Material requests</h2></div>
          <p style={{ margin: 0 }}><b className="tnum">{open}</b> <span className="muted">open</span></p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => go('materials')}>Request material</button>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Rooms</h2></div>
        {!summary.rooms.length ? <Empty>No rooms yet.</Empty> : (
          <div className="list">
            {summary.rooms.map((r) => (
              <button key={r.id} className="row" style={{ width: '100%', background: 'none', border: 0, padding: '12px 0', textAlign: 'left', cursor: 'pointer', alignItems: 'stretch', flexDirection: 'column', gap: 6 }} onClick={() => go('plan')}>
                <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><b>{r.name}</b><span className="tnum">{pct(r.pct)}</span></span>
                <Bar value={r.pct} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
