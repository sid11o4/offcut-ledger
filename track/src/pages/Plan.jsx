import { useState } from 'react'
import { Bar, Empty, Field, Loading, Modal, useAction } from '../components/ui'
import { activeTasks, itemPct, pct, statusLabel } from '../lib/progress'
import { addRoom, addItem, updateItem, deleteItem, renameRoom, deleteRoom } from '../lib/api'

const STEPS = [0, 25, 50, 75, 100]

export default function Plan({ project, data, isAdmin }) {
  const { plan, summary, categories, loading, error, reload, setTask } = data
  const act = useAction()
  const [openItem, setOpenItem] = useState(null)
  const [editing, setEditing] = useState(null) // {item?, roomId}
  const [roomName, setRoomName] = useState('')

  if (!project) return <Empty>Select a project.</Empty>
  if (loading) return <Loading />
  if (error) return <div className="notice">{error}</div>

  const sel = plan.items.find((i) => i.id === openItem)
  return (
    <div className="stack">
      {isAdmin && (
        <form className="card row" onSubmit={async (e) => { e.preventDefault(); if (!roomName.trim()) return; if (await act(() => addRoom(project.id, roomName.trim(), plan.rooms.length), 'Room added')) { setRoomName(''); reload() } }}>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="New room (e.g. Master bedroom)" value={roomName} onChange={(e) => setRoomName(e.target.value)} aria-label="New room name" />
          <button className="btn btn-primary">Add room</button>
        </form>
      )}
      {!summary.rooms.length && <Empty>No rooms yet.</Empty>}
      {summary.rooms.map((room) => {
        const items = plan.items.filter((i) => i.roomId === room.id)
        return (
          <section className="card" key={room.id}>
            <div className="card-head">
              <h2>{room.name}</h2><span className="tnum">{pct(room.pct)}</span><span className="spacer" />
              {isAdmin && <>
                <button className="btn btn-sm" onClick={() => setEditing({ roomId: room.id })}>Add item</button>
                <button className="btn btn-sm" onClick={async () => { const n = prompt('Rename room', room.name); if (n && n.trim() && await act(() => renameRoom(room.id, n.trim()))) reload() }}>Rename</button>
                <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete ${room.name} and its ${items.length} items?`) && await act(() => deleteRoom(room.id), 'Room deleted')) reload() }}>Delete</button>
              </>}
            </div>
            <Bar value={room.pct} />
            {!items.length ? <Empty>No items.</Empty> : (
              <div className="list" style={{ marginTop: 12 }}>
                {items.map((it) => {
                  const p = itemPct(it.cat, it.polish, it.progress)
                  return (
                    <button key={it.id} onClick={() => setOpenItem(it.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', minHeight: 56 }}>
                      <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                        <span><b>{it.title}</b><br /><span className="muted small">{it.cat?.name} · {it.sqft} sq ft{it.polish === 'Yes' ? ' · polish' : ''} · {statusLabel(p)}</span></span>
                        <span className="tnum">{pct(p)}</span>
                      </span>
                      <Bar value={p} />
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      {sel && (
        <Modal title={sel.title} onClose={() => setOpenItem(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>{sel.cat?.name} · {sel.sqft} sq ft · <b className="tnum">{pct(itemPct(sel.cat, sel.polish, sel.progress))}</b> complete</p>
          {activeTasks(sel.cat, sel.polish).map((t, i) => {
            const v = Number(sel.progress[i]) || 0
            return (
              <div className="task" key={t.name + i}>
                <b>{t.name}</b><span className="tnum">{v}%</span>
                <div className="steps" role="group" aria-label={`${t.name} progress`}>
                  {STEPS.map((s) => <button key={s} className={`step${s === 100 ? ' done' : ''}`} aria-pressed={v === s} onClick={() => act(() => setTask(sel.id, i, s))}>{s}</button>)}
                </div>
              </div>
            )
          })}
          {isAdmin && <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => { setEditing({ item: sel, roomId: sel.roomId }); setOpenItem(null) }}>Edit item</button>
            <button className="btn btn-danger" onClick={async () => { if (confirm(`Delete "${sel.title}"?`) && await act(() => deleteItem(sel.id), 'Item deleted')) { setOpenItem(null); reload() } }}>Delete</button>
          </div>}
        </Modal>
      )}
      {editing && <ItemForm project={project} categories={categories} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function ItemForm({ project, categories, editing, onClose, onSaved }) {
  const act = useAction()
  const it = editing.item
  const [title, setTitle] = useState(it?.title || '')
  const [categoryId, setCategoryId] = useState(it?.categoryId || categories[0]?.id || '')
  const [sqft, setSqft] = useState(it?.sqft ?? '')
  const [polish, setPolish] = useState(it?.polish || 'No')
  const cat = categories.find((c) => c.id === categoryId)

  async function save(e) {
    e.preventDefault()
    const row = { title: title.trim(), category_id: categoryId, sqft: Number(sqft) || 0, polish: cat?.hasPolish ? polish : 'No' }
    const ok = await act(() => (it ? updateItem(it.id, row) : addItem({ ...row, project_id: project.id, room_id: editing.roomId })), 'Saved')
    if (ok) onSaved()
  }
  return (
    <Modal title={it ? 'Edit item' : 'Add item'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Title"><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wardrobe 6x7" /></Field>
        <Field label="Category"><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Area (sq ft)"><input className="input" type="number" min="0" step="any" inputMode="decimal" value={sqft} onChange={(e) => setSqft(e.target.value)} /></Field>
        {cat?.hasPolish && <Field label="Polish / paint"><select className="input" value={polish} onChange={(e) => setPolish(e.target.value)}><option>No</option><option>Yes</option></select></Field>}
        {it && <p className="muted small" style={{ margin: 0 }}>Changing the category or polish re-maps the saved task progress by position.</p>}
        <button className="btn btn-primary">Save</button>
      </form>
    </Modal>
  )
}
