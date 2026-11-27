import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'
import { listRequests } from '../lib/api'
import { pct, statusLabel } from '../lib/progress'
import { buildReport, parseCaption, points, taskPhrase } from '../lib/report'
import { Symbol } from '../components/Brand'
import '../report.css'

const LONG = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const SHORT = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const TIME = (ts) => new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })

// Full-screen, printable daily report. variant: 'client' | 'internal'.
export default function Report({ variant: initial, project, plan, report, dayNumber, photos, onClose }) {
  const user = useAuth()?.user
  const [variant, setVariant] = useState(initial)
  const [requests, setRequests] = useState([])

  useEffect(() => {
    let live = true
    listRequests(project.id).then((r) => live && setRequests(r)).catch(() => {})
    return () => { live = false }
  }, [project.id])

  // Only the report prints while it is open, and the page title becomes the PDF file name.
  useEffect(() => {
    const title = document.title
    document.body.classList.add('report-open')
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => { document.body.classList.remove('report-open'); document.title = title; window.removeEventListener('keydown', k) }
  }, [onClose])

  const r = useMemo(() => buildReport({ project, plan, report, dayNumber, photos, requests }), [project, plan, report, dayNumber, photos, requests])
  useEffect(() => {
    document.title = `${project.name} – ${variant === 'client' ? 'Site report' : 'Internal site report'} – ${report.report_date}`
  }, [project.name, variant, report.report_date])

  return createPortal(
    <div className="rpt-screen">
      <div className="rpt-toolbar">
        <button className="btn btn-sm" onClick={onClose}>← Back</button>
        <div className="rpt-switch" role="tablist" aria-label="Report version">
          <button role="tab" aria-selected={variant === 'client'} onClick={() => setVariant('client')}>Client</button>
          <button role="tab" aria-selected={variant === 'internal'} onClick={() => setVariant('internal')}>Internal</button>
        </div>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Save PDF</button>
      </div>
      {!r.closed && <p className="rpt-draft-note">This day is still open. Figures are live and will change until the day is closed.</p>}
      <div className="rpt">
        {variant === 'client' ? <ClientReport r={r} /> : <InternalReport r={r} who={user?.email} />}
      </div>
    </div>,
    document.body,
  )
}

/* ─────────────── Client-facing ─────────────── */

function ClientReport({ r }) {
  const { overall } = r
  const gain = Math.max(0, overall.moved)
  return (
    <article className="sheet client">
      <header className="band">
        <Symbol className="ghost" />
        <div className="lockup">
          <Symbol />
          <div>
            <div className="wordmark">FORMGRID</div>
            <div className="descriptor">INTERIOR DESIGN AND BUILD STUDIO</div>
          </div>
        </div>
        <div className="band-row">
          <div>
            <div className="doc-title">DAILY SITE REPORT</div>
            <div className="tagline">DESIGN &nbsp;|&nbsp; BUILD &nbsp;|&nbsp; SOLVE</div>
          </div>
          <dl className="doc-meta">
            {r.dayNumber && <><dt>Site day</dt><dd>{String(r.dayNumber).padStart(2, '0')}</dd></>}
            <dt>Date</dt><dd>{SHORT(r.date)}</dd>
            <dt>Status</dt><dd>{r.closed ? 'Day closed' : 'In progress'}</dd>
          </dl>
        </div>
      </header>

      <section className="parties">
        <div className="party">
          <div className="label">Project</div>
          <div className="name">{r.project.name}</div>
          <div className="muted">{LONG(r.date)}</div>
        </div>
        <div className="party">
          {r.project.client && <><div className="label">Prepared for</div><div className="name sm">{r.project.client}</div></>}
          {r.project.location && <div className="muted">{r.project.location}</div>}
        </div>
      </section>

      {!r.hasSnapshot ? (
        <section className="block">
          <div className="note-box">This day was recorded in the previous tracker, which kept no task-by-task record, so progress figures are not available for it. The site notes and photographs below are as recorded.</div>
        </section>
      ) : (<>
      <section className="headline">
        <div className="big">
          <div className="label">Overall completion</div>
          <div className="figure">{Math.round(overall.end * 100)}<span>%</span></div>
          <div className="state">{statusLabel(Math.round(overall.end * 100) / 100)}</div>
        </div>
        <div className="headline-side">
          <div className="today-gain">
            <span className="label">Today</span>
            <b>{points(overall.moved)}</b><span className="unit">pts</span>
          </div>
          <div className="track" aria-label={`Progress ${pct(overall.end)}, of which ${points(gain)} points today`}>
            <i className="before" style={{ width: pct(Math.min(overall.start, overall.end)) }} />
            <i className="gain" style={{ left: pct(Math.min(overall.start, overall.end)), width: pct(gain) }} />
          </div>
          <div className="track-legend"><span><i className="sw before" />Completed earlier</span><span><i className="sw gain" />Added today</span></div>
          <dl className="stats">
            <div><dt>Rooms progressed</dt><dd>{r.roomsMoved}</dd></div>
            <div><dt>Tasks advanced</dt><dd>{r.tasksMoved}</dd></div>
            <div><dt>Tasks completed</dt><dd>{r.tasksCompleted}</dd></div>
          </dl>
        </div>
      </section>

      <section className="block">
        <Heading>Work carried out today</Heading>
        {!r.work.length ? (
          <p className="quiet">No measurable progress was recorded on site today.</p>
        ) : r.work.map((w) => {
          const room = r.rooms.find((x) => x.id === w.roomId)
          return (
            <div key={w.roomId} className="room">
              <div className="sec-head">
                <span className="sec-name">{w.room}</span>
                <span className="spacer" />
                {room && <span className="sec-pct">{pct(room.start)} <em>→</em> <b>{pct(room.now)}</b></span>}
              </div>
              {w.items.map((it) => (
                <div key={it.id} className="work-item">
                  <div className="item-title">{it.title}{it.category && <span className="item-dim">{it.category}</span>}</div>
                  <ul className="tasks">
                    {it.tasks.map((t) => (
                      <li key={t.name} className={t.to === 100 ? 'done' : ''}>
                        <span className="tick" aria-hidden="true" />
                        <span className="t-name">{t.name}</span>
                        <span className="t-state">{taskPhrase(t)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        })}
      </section>

      <section className="block">
        <Heading>Room by room</Heading>
        <table className="rooms">
          <tbody>
            {r.rooms.filter((x) => x.items).map((x) => (
              <tr key={x.id} className={x.moved > 0.0005 ? 'moved' : ''}>
                <td className="r-name">{x.name}</td>
                <td className="r-bar"><div className="mini-track"><i style={{ width: pct(x.now) }} /></div></td>
                <td className="num r-pct">{pct(x.now)}</td>
                <td className="num r-delta">{x.moved > 0.0005 ? `${points(x.moved)} pts today` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </>)}

      {r.photos.length > 0 && (
        <section className="block photos-block">
          <Heading>Site photographs</Heading>
          <div className="gallery">
            {r.photos.map((p, i) => {
              const c = parseCaption(p.caption)
              return (
                <figure key={p.id}>
                  <img src={p.url} alt={p.caption || `Site photograph ${i + 1}`} />
                  <figcaption>
                    <span className="n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="cap">{c.task && <b>{c.task}</b>}{c.item && <em>{[c.item, c.room].filter(Boolean).join(' · ')}</em>}</span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      )}

      {r.nextPlan && (
        <section className="block">
          <Heading>Next on site</Heading>
          <div className="note-box">{r.nextPlan}</div>
        </section>
      )}

      <footer className="closing">
        <div className="mini"><Symbol /><b>FORMGRID</b></div>
        <div className="conf">Progress is measured task by task and weighted by area and trade. Figures are as recorded on site{r.closed ? ' at close of day' : ' so far today'}.</div>
      </footer>
    </article>
  )
}

/* ─────────────── Internal ─────────────── */

function InternalReport({ r, who }) {
  const { overall } = r
  const [generated] = useState(() => new Date().toISOString())
  return (
    <article className="sheet internal">
      <header className="int-head">
        <div className="mini"><Symbol /><b>FORMGRID</b><span className="sub">Track</span></div>
        <span className="spacer" />
        <span className="stamp">Internal · Not for client</span>
      </header>

      <div className="int-title">
        <div>
          <div className="label">Daily site report</div>
          <h1>{r.project.name}</h1>
          <div className="muted">{[r.project.client, r.project.location].filter(Boolean).join(' · ')}</div>
        </div>
        <dl className="int-meta">
          <dt>Date</dt><dd>{LONG(r.date)}</dd>
          {r.dayNumber && <><dt>Site day</dt><dd>{r.dayNumber}</dd></>}
          <dt>Status</dt><dd>{r.closed ? `Closed ${TIME(r.closedAt)}` : 'Open'}</dd>
        </dl>
      </div>

      <dl className="kpis">
        <div><dt>Start</dt><dd>{overall.start == null ? '—' : pct(overall.start)}</dd></div>
        <div><dt>{r.closed ? 'End' : 'Now'}</dt><dd>{overall.end == null ? '—' : pct(overall.end)}</dd></div>
        <div className={overall.moved > 0 ? 'up' : overall.moved < 0 ? 'down' : ''}><dt>Moved</dt><dd>{overall.moved == null ? '—' : <>{points(overall.moved)}<small>pts</small></>}</dd></div>
        <div><dt>Tasks moved</dt><dd>{r.tasksMoved}<small>/ {r.tasksCompleted} done</small></dd></div>
        <div><dt>Headcount</dt><dd>{r.headcount}</dd></div>
        <div><dt>Man-shifts</dt><dd>{r.manShifts}</dd></div>
      </dl>

      <section className={`flag ${r.issues ? 'has' : ''}`}>
        <div className="label">Issues / blockers</div>
        <p>{r.issues || 'None reported.'}</p>
      </section>

      <section className="block">
        <Heading>Work done <Count n={r.tasksMoved} /></Heading>
        {!r.hasSnapshot ? <p className="quiet">No task snapshot for this day (imported from the previous tracker).</p> : !r.work.length ? <p className="quiet">No task progress changed.</p> : (
          <table className="grid-table">
            <thead><tr><th>Room</th><th>Item</th><th>Task</th><th className="num">From</th><th className="num">To</th><th className="num">Δ</th></tr></thead>
            <tbody>
              {r.work.flatMap((w) => w.items.flatMap((it, ii) => it.tasks.map((t, ti) => (
                <tr key={`${it.id}-${t.name}`} className={ii === 0 && ti === 0 ? 'group-start' : ''}>
                  <td className="dim">{ii === 0 && ti === 0 ? w.room : ''}</td>
                  <td>{ti === 0 ? it.title : ''}</td>
                  <td>{t.name}{t.to === 100 && <span className="tag ok">Done</span>}{t.to < t.from && <span className="tag bad">Reduced</span>}</td>
                  <td className="num dim">{t.from}%</td>
                  <td className="num">{t.to}%</td>
                  <td className={`num ${t.to > t.from ? 'pos' : 'neg'}`}>{t.to > t.from ? '+' : '−'}{Math.abs(t.to - t.from)}</td>
                </tr>
              ))))}
            </tbody>
          </table>
        )}
      </section>

      <div className="two-col">
        <section className="block">
          <Heading>Labour on site</Heading>
          {!r.labour.length ? <p className="quiet">None recorded.</p> : (
            <table className="grid-table">
              <thead><tr><th>Trade</th><th className="num">People</th><th className="num">Shifts</th></tr></thead>
              <tbody>
                {r.labour.map((l, i) => <tr key={i}><td>{l.trade || '—'}</td><td className="num">{l.count || 0}</td><td className="num">{l.shifts === '' || l.shifts == null ? 1 : l.shifts}</td></tr>)}
                <tr className="total"><td>Total</td><td className="num">{r.headcount}</td><td className="num">{r.manShifts} man-shifts</td></tr>
              </tbody>
            </table>
          )}
        </section>
        <section className="block">
          <Heading>Materials</Heading>
          {!r.materials.length ? <p className="quiet">None recorded.</p> : (
            <table className="grid-table">
              <thead><tr><th>Material</th><th className="num">Qty</th><th>Status</th></tr></thead>
              <tbody>
                {r.materials.map((m, i) => <tr key={i}><td>{m.name}</td><td className="num">{m.qty ?? ''} {m.unit || ''}</td><td className="st"><span className={`tag ${m.status === 'Received' ? 'ok' : m.status === 'Not Ordered' ? 'bad' : ''}`}>{m.status || 'Not Ordered'}</span></td></tr>)}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="block">
        <Heading>Open material requests <Count n={r.openRequests.length} /></Heading>
        {!r.openRequests.length ? <p className="quiet">No open requests.</p> : (
          <table className="grid-table">
            <thead><tr><th>Raised</th><th>Items</th><th>Needed by</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>
              {r.openRequests.map((q) => (
                <tr key={q.id}>
                  <td className="dim">{SHORT(q.created_at.slice(0, 10))}</td>
                  <td>{(q.items || []).map((x) => `${x.inventory_items?.name || x.free_text_name} × ${x.quantity}${x.unit_text ? ' ' + x.unit_text : ''}`).join(', ')}</td>
                  <td>{q.needed_by ? SHORT(q.needed_by) : '—'}</td>
                  <td className="st">{q.priority === 'urgent' ? <span className="tag bad">Urgent</span> : q.priority}</td>
                  <td className="st"><span className="tag">{q.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="block">
        <Heading>Plan for tomorrow</Heading>
        <div className="note-box">{r.nextPlan || <span className="quiet">Not written.</span>}</div>
      </section>

      {r.hasSnapshot && <section className="block">
        <Heading>Room progress</Heading>
        <table className="grid-table rooms-int">
          <thead><tr><th>Room</th><th className="num">Start</th><th className="num">End</th><th className="num">Δ pts</th><th /></tr></thead>
          <tbody>
            {r.rooms.map((x) => (
              <tr key={x.id}>
                <td>{x.name}{!x.items && <span className="tag">No items</span>}</td>
                <td className="num dim">{pct(x.start)}</td>
                <td className="num">{pct(x.now)}</td>
                <td className={`num ${x.moved > 0.0005 ? 'pos' : x.moved < -0.0005 ? 'neg' : 'dim'}`}>{Math.abs(x.moved) > 0.0005 ? points(x.moved) : '—'}</td>
                <td className="r-bar"><div className="mini-track"><i style={{ width: pct(x.now) }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>}

      {r.photos.length > 0 && (
        <section className="block photos-block">
          <Heading>Photos <Count n={r.photos.length} /></Heading>
          <div className="thumbs">{r.photos.map((p) => {
            const c = parseCaption(p.caption)
            return <figure key={p.id}><img src={p.url} alt={p.caption || 'Site photo'} />{c.task && <figcaption><b>{c.task}</b>{c.item && <span>{c.item}</span>}</figcaption>}</figure>
          })}</div>
        </section>
      )}

      <footer className="int-foot">
        <span>Generated {TIME(generated)}{who ? ` by ${who}` : ''}</span>
        <span>FORMGRID Track · internal use only</span>
      </footer>
    </article>
  )
}

function Heading({ children }) {
  return <div className="h-block"><span className="rule" /><h2>{children}</h2></div>
}
const Count = ({ n }) => <span className="count">{n}</span>
