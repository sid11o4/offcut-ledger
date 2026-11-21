import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { Empty, Field, Loading, useAction } from '../components/ui'
import { dayChanges, localDateKey, pct } from '../lib/progress'
import { getReport, listReports, startDay, saveDetails, closeDay, reopenDay, listPhotos, uploadPhoto, deletePhoto, summarise } from '../lib/api'

const LONG = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export default function SiteLog({ project, data }) {
  const [date, setDate] = useState(localDateKey())
  const [history, setHistory] = useState([])
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!project) return
    let live = true
    listReports(project.id).then((r) => live && setHistory(r)).catch(() => {})
    return () => { live = false }
  }, [project, tick])

  if (!project) return <Empty>Select a project.</Empty>
  if (data.loading) return <Loading />
  const today = localDateKey()
  const dates = [...new Set([today, ...history.map((h) => h.report_date)])]
  return (
    <div className="stack">
      <div className="row no-print">
        <select className="input" style={{ maxWidth: 320 }} aria-label="Report date" value={date} onChange={(e) => setDate(e.target.value)}>
          {dates.map((d) => <option key={d} value={d}>{d === today ? 'Today · ' : ''}{LONG(d)}</option>)}
        </select>
      </div>
      <Day key={project.id + date} project={project} data={data} date={date} isToday={date === today} onChanged={refresh} />
    </div>
  )
}

function Day({ project, data, date, isToday, onChanged }) {
  const { user } = useAuth()
  const act = useAction()
  const { plan } = data
  const [report, setReport] = useState(undefined)
  const [photos, setPhotos] = useState([])
  const [draft, setDraft] = useState(null)
  const timer = useRef(null)

  const load = useCallback(async () => {
    const r = await getReport(project.id, date)
    setReport(r)
    setDraft(r ? { next_day_plan: r.next_day_plan, issues: r.issues, materials: r.materials, labour: r.labour } : null)
    setPhotos(await listPhotos(project.id, date))
  }, [project.id, date])
  useEffect(() => { load().catch(() => setReport(null)) }, [load])

  // Details save a moment after typing stops, so nothing is lost if the day is closed or the tab dies.
  function edit(patch) {
    const next = { ...draft, ...patch }
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => act(() => saveDetails(report.id, next)), 800)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (report === undefined) return <Loading />
  if (!report) {
    return isToday ? (
      <section className="card stack">
        <h2>Start today's report</h2>
        <p className="muted" style={{ margin: 0 }}>Starting the day records where every task stands now, so tonight's report can show exactly what moved.</p>
        <button className="btn btn-primary" onClick={async () => { if (await act(() => startDay(project.id, date, plan, user.id), 'Day started')) { await load(); onChanged() } }}>Start day</button>
      </section>
    ) : <Empty>No report was recorded for this day.</Empty>
  }

  const closed = Boolean(report.closed_at)
  // For a closed day compare against the saved end state; for an open day against the live plan.
  const items = plan.items.map((i) => ({ ...i, progress: closed && report.end_state?.[i.id] ? report.end_state[i.id] : i.progress }))
  const { changed, completed } = dayChanges(items, report.start_state || {})
  const nowPct = closed ? report.end_pct : summarise(plan).overall
  const moved = (nowPct || 0) - report.start_pct
  const byItem = Object.entries(changed.reduce((m, c) => { (m[c.item] ||= []).push(c); return m }, {}))

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>{LONG(date)}</h2><span className="spacer" />{closed ? <span className="pill pill-ok">Closed</span> : <span className="pill pill-brand">Open</span>}</div>
        <div className="row" style={{ gap: 24 }}>
          <div><div className="muted small">Started at</div><div className="tnum" style={{ fontSize: 24 }}>{pct(report.start_pct)}</div></div>
          <div><div className="muted small">{closed ? 'Ended at' : 'Now'}</div><div className="tnum" style={{ fontSize: 24 }}>{pct(nowPct)}</div></div>
          <div><div className="muted small">Moved</div><div className="tnum" style={{ fontSize: 24, color: moved > 0 ? 'var(--ok)' : undefined }}>{moved > 0 ? '+' : ''}{(moved * 100).toFixed(1)} pts</div></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Work done</h2></div>
        {!byItem.length ? <p className="muted" style={{ margin: 0 }}>No task progress changed {closed ? 'this day' : 'yet'}. Update tasks under Rooms &amp; BOQ.</p> : (
          <div className="list">
            {byItem.map(([item, rows]) => (
              <div key={item}><b>{item}</b>
                {rows.map((r) => <div key={r.task} className="row small" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span>{r.task}</span><span className="tnum">{r.from}% → {r.to}%</span></div>)}
              </div>
            ))}
          </div>
        )}
        {completed.length > 0 && <p className="small" style={{ marginBottom: 0 }}><b>Completed:</b> {completed.map((c) => `${c.item} – ${c.task}`).join('; ')}</p>}
      </section>

      <Rows title="Labour on site" cols={[['trade', 'Trade'], ['count', 'People', 'number'], ['hours', 'Hours', 'number']]} rows={draft.labour} readOnly={closed} onChange={(labour) => edit({ labour })} />
      <Rows title="Materials" cols={[['name', 'Material'], ['qty', 'Qty', 'number'], ['unit', 'Unit'], ['status', 'Status', ['Not ordered', 'Ordered', 'In transit', 'Received']]]} rows={draft.materials} readOnly={closed} onChange={(materials) => edit({ materials })} />

      <section className="card stack">
        <Field label="Issues / blockers"><textarea className="input" readOnly={closed} value={draft.issues} onChange={(e) => edit({ issues: e.target.value })} /></Field>
        <Field label="Plan for tomorrow"><textarea className="input" readOnly={closed} value={draft.next_day_plan} onChange={(e) => edit({ next_day_plan: e.target.value })} /></Field>
      </section>

      <section className="card">
        <div className="card-head"><h2>Photos</h2><span className="spacer" />
          {!closed && <label className="btn btn-sm no-print" style={{ display: 'inline-grid', placeItems: 'center' }}>Add photos
            <input type="file" accept="image/*" multiple capture="environment" hidden onChange={async (e) => {
              const files = [...e.target.files]; e.target.value = ''
              if (await act(async () => { for (const f of files) await uploadPhoto(project.id, date, f, user.id) }, 'Photos added')) setPhotos(await listPhotos(project.id, date))
            }} /></label>}
        </div>
        {!photos.length ? <p className="muted" style={{ margin: 0 }}>No photos.</p> : (
          <div className="photos">{photos.map((p) => (
            <figure key={p.id} style={{ margin: 0, position: 'relative' }}>
              <img src={p.url} alt="Site" loading="lazy" />
              {!closed && <button className="btn btn-sm no-print" style={{ position: 'absolute', top: 4, right: 4, minHeight: 28, padding: '0 8px' }} aria-label="Delete photo"
                onClick={async () => { if (confirm('Delete this photo?') && await act(() => deletePhoto(p))) setPhotos(await listPhotos(project.id, date)) }}>✕</button>}
            </figure>))}
          </div>
        )}
      </section>

      <div className="row no-print">
        {!closed && <button className="btn btn-primary" onClick={async () => {
          clearTimeout(timer.current)
          if (await act(async () => { await saveDetails(report.id, draft); await closeDay(report.id, plan, user.id) }, 'Day closed')) { await load(); onChanged() }
        }}>Close day &amp; finish report</button>}
        {closed && <>
          <button className="btn btn-primary" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn" onClick={async () => { if (await act(() => reopenDay(report.id), 'Day reopened')) { await load(); onChanged() } }}>Reopen day</button>
        </>}
      </div>
    </div>
  )
}

function Rows({ title, cols, rows, onChange, readOnly }) {
  const blank = Object.fromEntries(cols.map(([k, , t]) => [k, Array.isArray(t) ? t[0] : t === 'number' ? '' : '']))
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <section className="card">
      <div className="card-head"><h2>{title}</h2><span className="spacer" />{!readOnly && <button className="btn btn-sm no-print" onClick={() => onChange([...rows, { ...blank }])}>Add row</button>}</div>
      {!rows.length ? <p className="muted" style={{ margin: 0 }}>None recorded.</p> : rows.map((r, i) => (
        <div key={i} className="row" style={{ marginBottom: 8, alignItems: 'flex-end' }}>
          {cols.map(([k, label, t]) => (
            <label key={k} className="field" style={{ flex: k === 'name' || k === 'trade' ? '2 1 160px' : '1 1 90px' }}>
              <span>{label}</span>
              {Array.isArray(t)
                ? <select className="input" disabled={readOnly} value={r[k] ?? t[0]} onChange={(e) => set(i, k, e.target.value)}>{t.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className="input" readOnly={readOnly} type={t === 'number' ? 'number' : 'text'} inputMode={t === 'number' ? 'decimal' : undefined} min={t === 'number' ? 0 : undefined} value={r[k] ?? ''} onChange={(e) => set(i, k, t === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />}
            </label>
          ))}
          {!readOnly && <button className="btn btn-sm btn-danger no-print" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
    </section>
  )
}
