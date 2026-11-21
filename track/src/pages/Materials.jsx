import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { Empty, Field, Loading, Modal, useAction } from '../components/ui'
import { inventoryCatalog, listRequests, createRequest, setRequestStatus } from '../lib/api'

const TONE = { requested: 'pill-warn', approved: 'pill-brand', fulfilled: 'pill-ok', rejected: 'pill-bad', cancelled: '' }
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export default function Materials({ project, isAdmin }) {
  const { user } = useAuth()
  const act = useAction()
  const [requests, setRequests] = useState(null)
  const [building, setBuilding] = useState(false)
  const [deciding, setDeciding] = useState(null)

  const load = async () => { try { setRequests(await listRequests(project.id)) } catch { setRequests([]) } }
  useEffect(() => { if (project) load() }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <Empty>Select a project.</Empty>
  return (
    <div className="stack">
      <div className="row"><h1>Material requests</h1><span className="spacer" /><button className="btn btn-primary" onClick={() => setBuilding(true)}>New request</button></div>
      {requests === null ? <Loading /> : !requests.length ? <Empty>No requests yet. Raise one to ask for material from the factory inventory or from outside it.</Empty> : requests.map((r) => (
        <section className="card" key={r.id}>
          <div className="card-head">
            <span className={`pill ${TONE[r.status]}`}>{r.status}</span>
            {r.priority === 'urgent' && <span className="pill pill-bad">urgent</span>}
            <span className="muted small">{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{r.needed_by ? ` · needed by ${new Date(r.needed_by + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span>
          </div>
          <table className="table"><tbody>
            {r.items.map((l) => (
              <tr key={l.id}><td>{l.inventory_items?.name || l.free_text_name} {!l.item_id && <span className="pill">outside inventory</span>}</td><td className="num tnum">{qty(l.quantity)} {l.unit_text || ''}</td></tr>
            ))}
          </tbody></table>
          {r.note && <p className="small" style={{ marginBottom: 0 }}>{r.note}</p>}
          {r.response_note && <p className="small muted" style={{ marginBottom: 0 }}>Reply: {r.response_note}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            {isAdmin && ['requested', 'approved'].includes(r.status) && <button className="btn btn-sm" onClick={() => setDeciding(r)}>Update status</button>}
            {r.requested_by === user.id && r.status === 'requested' && <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Cancel this request?') && await act(() => setRequestStatus(r.id, 'cancelled', null, user.id, false), 'Cancelled')) load() }}>Cancel</button>}
          </div>
        </section>
      ))}
      {building && <Builder project={project} onClose={() => setBuilding(false)} onSaved={() => { setBuilding(false); load() }} />}
      {deciding && <Decide req={deciding} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); load() }} />}
    </div>
  )
}

function Decide({ req, onClose, onSaved }) {
  const { user } = useAuth()
  const act = useAction()
  const [note, setNote] = useState(req.response_note || '')
  const go = async (status) => { if (await act(() => setRequestStatus(req.id, status, note, user.id, true), 'Updated')) onSaved() }
  return (
    <Modal title="Update request" onClose={onClose}>
      <div className="stack">
        <Field label="Reply to site (optional)"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="row">
          {req.status === 'requested' && <button className="btn btn-primary" onClick={() => go('approved')}>Approve</button>}
          <button className="btn" onClick={() => go('fulfilled')}>Mark fulfilled</button>
          <button className="btn btn-danger" onClick={() => go('rejected')}>Reject</button>
        </div>
      </div>
    </Modal>
  )
}

function Builder({ project, onClose, onSaved }) {
  const { user } = useAuth()
  const act = useAction()
  const [lines, setLines] = useState([])
  const [picker, setPicker] = useState(false)
  const [out, setOut] = useState({ name: '', quantity: '', unit: '' })
  const [needed, setNeeded] = useState('')
  const [priority, setPriority] = useState('normal')
  const [note, setNote] = useState('')

  const setQty = (i, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: v } : l)))
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0)

  async function submit() {
    const ok = await act(() => createRequest(project.id, user.id, { needed_by: needed || null, priority, note: note.trim() || null },
      lines.map((l) => ({ ...l, quantity: Number(l.quantity) }))), 'Request sent')
    if (ok) onSaved()
  }

  return (
    <Modal title="New material request" onClose={onClose}>
      <div className="stack">
        <div className="row">
          <button className="btn" onClick={() => setPicker(true)}>Choose from live inventory</button>
        </div>
        <fieldset style={{ border: '1px solid var(--ink-200)', borderRadius: 8, padding: 12 }}>
          <legend className="small muted" style={{ padding: '0 6px' }}>Not in inventory</legend>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '2 1 160px' }}><span>Material</span><input className="input" value={out.name} onChange={(e) => setOut({ ...out, name: e.target.value })} placeholder="e.g. 18mm marine ply" /></label>
            <label className="field" style={{ flex: '1 1 80px' }}><span>Qty</span><input className="input" type="number" min="0" step="any" inputMode="decimal" value={out.quantity} onChange={(e) => setOut({ ...out, quantity: e.target.value })} /></label>
            <label className="field" style={{ flex: '1 1 80px' }}><span>Unit</span><input className="input" value={out.unit} onChange={(e) => setOut({ ...out, unit: e.target.value })} placeholder="sheets" /></label>
            <button className="btn" disabled={!out.name.trim() || !(Number(out.quantity) > 0)} onClick={() => { setLines([...lines, { name: out.name.trim(), quantity: out.quantity, unit: out.unit.trim() }]); setOut({ name: '', quantity: '', unit: '' }) }}>Add</button>
          </div>
        </fieldset>

        {lines.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 6 }}>Request lines</h3>
            {lines.map((l, i) => (
              <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}><b>{l.name}</b> {!l.itemId && <span className="pill">outside</span>}{l.itemId && <div className="muted small tnum">In stock: factory {qty(l.company)} · site {qty(l.site)} {l.unit}</div>}</div>
                <input className="input" style={{ width: 90 }} type="number" min="0" step="any" inputMode="decimal" aria-label={`Quantity of ${l.name}`} value={l.quantity} onChange={(e) => setQty(i, e.target.value)} />
                <span className="muted small" style={{ width: 44 }}>{l.unit}</span>
                <button className="btn btn-sm btn-danger" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="row">
          <label className="field" style={{ flex: 1 }}><span>Needed by</span><input className="input" type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span>Priority</span><select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label>
        </div>
        <Field label="Note (optional)"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>Send request</button>
      </div>
      {picker && <InventoryPicker project={project} taken={lines.filter((l) => l.itemId).map((l) => l.itemId)} onClose={() => setPicker(false)}
        onPick={(it) => { setLines((ls) => [...ls, { itemId: it.item_id, name: it.name, unit: it.unit || '', quantity: '1', company: it.company_qty, site: it.project_qty }]); setPicker(false) }} />}
    </Modal>
  )
}

// Live stock: company inventory plus this project's own stock, read-only.
function InventoryPicker({ project, taken, onPick, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    inventoryCatalog(project.id).then((r) => live && setRows(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [project.id])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows || []).filter((r) => !taken.includes(r.item_id) && (!t || `${r.name} ${r.category || ''}`.toLowerCase().includes(t)))
  }, [rows, q, taken])
  return (
    <Modal title="Live inventory" onClose={onClose}>
      <div className="stack">
        <input className="input" autoFocus placeholder="Search material or category" aria-label="Search inventory" value={q} onChange={(e) => setQ(e.target.value)} />
        {error && <div className="notice">{error}</div>}
        {rows === null && !error ? <Loading /> : (
          <div className="search-results">
            {!shown.length ? <Empty>No match. Add it under “Not in inventory”.</Empty> : shown.slice(0, 200).map((r) => {
              const total = Number(r.company_qty) + Number(r.project_qty)
              return (
                <button key={r.item_id} onClick={() => onPick(r)}>
                  <span style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b><br /><span className="muted small">{r.category || 'Uncategorised'}</span></span>
                  <span className="tnum" style={{ textAlign: 'right' }}>{qty(total)} {r.unit}<br /><span className={`small ${total > 0 ? 'muted' : ''}`} style={total > 0 ? undefined : { color: 'var(--bad)' }}>{total > 0 ? `factory ${qty(r.company_qty)} · site ${qty(r.project_qty)}` : 'out of stock'}</span></span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
