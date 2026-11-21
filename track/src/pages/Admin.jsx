import { useEffect, useState } from 'react'
import { Empty, Field, Loading, Modal, useAction } from '../components/ui'
import { addProject, updateProject, saveCategory, deleteCategory, listMembers, setMember, removeMember } from '../lib/api'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function Admin({ projects, refreshProjects, data }) {
  return (
    <div className="stack">
      <Projects projects={projects} refresh={refreshProjects} />
      <Categories categories={data.categories} reload={data.reload} />
      <Members />
    </div>
  )
}

function Projects({ projects, refresh }) {
  const act = useAction()
  const [form, setForm] = useState(null)
  const [designs, setDesigns] = useState([])
  useEffect(() => { supabase.from('design_projects').select('id, code, name').order('name').then(({ data }) => setDesigns(data || [])) }, [])
  const save = async (e) => {
    e.preventDefault()
    const row = { name: form.name.trim(), client_name: form.client_name?.trim() || null, location: form.location?.trim() || null, status: form.status || 'active', design_project_id: form.design_project_id || null }
    if (await act(() => (form.id ? updateProject(form.id, row) : addProject(row)), 'Saved')) { setForm(null); refresh() }
  }
  return (
    <section className="card">
      <div className="card-head"><h2>Projects</h2><span className="spacer" /><button className="btn btn-sm btn-primary" onClick={() => setForm({ name: '' })}>New project</button></div>
      {!projects.length ? <Empty>No projects.</Empty> : <table className="table"><tbody>{projects.map((p) => (
        <tr key={p.id}><td><b>{p.name}</b><br /><span className="muted small">{[p.client_name, p.location].filter(Boolean).join(' · ')}</span></td><td><span className="pill">{p.status.replace('_', ' ')}</span></td><td className="num"><button className="btn btn-sm" onClick={() => setForm(p)}>Edit</button></td></tr>
      ))}</tbody></table>}
      {form && <Modal title={form.id ? 'Edit project' : 'New project'} onClose={() => setForm(null)}>
        <form className="stack" onSubmit={save}>
          <Field label="Name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Client"><input className="input" value={form.client_name || ''} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Status"><select className="input" value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select></Field>
          <Field label="Design Build project (shows progress on the factory dashboard and project stock in requests)">
            <select className="input" value={form.design_project_id || ''} onChange={(e) => setForm({ ...form, design_project_id: e.target.value })}>
              <option value="">Not linked</option>{designs.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select></Field>
          <button className="btn btn-primary">Save</button>
        </form>
      </Modal>}
    </section>
  )
}

function Categories({ categories, reload }) {
  const act = useAction()
  const [form, setForm] = useState(null)
  const total = form ? form.tasks.reduce((s, t) => s + (Number(t.points) || 0), 0) : 0
  const save = async (e) => {
    e.preventDefault()
    const c = { ...form, name: form.name.trim(), weight: Number(form.weight) || 0, tasks: form.tasks.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), points: Number(t.points) || 0 })) }
    if (await act(() => saveCategory(c), 'Saved')) { setForm(null); reload() }
  }
  return (
    <section className="card">
      <div className="card-head"><h2>Task categories</h2><span className="spacer" /><button className="btn btn-sm btn-primary" onClick={() => setForm({ name: '', weight: 1, hasPolish: false, tasks: [{ name: '', points: 10 }] })}>New category</button></div>
      <table className="table"><thead><tr><th>Category</th><th className="num">Weight</th><th className="num">Tasks</th><th /></tr></thead><tbody>
        {categories.map((c) => <tr key={c.id}><td><b>{c.name}</b> {c.isDefault && <span className="pill">default</span>}</td><td className="num tnum">{c.weight}</td><td className="num tnum">{c.tasks.length}</td><td className="num"><button className="btn btn-sm" onClick={() => setForm({ ...c })}>Edit</button></td></tr>)}
      </tbody></table>
      {form && <Modal title={form.id ? `Edit ${form.name}` : 'New category'} onClose={() => setForm(null)}>
        <form className="stack" onSubmit={save}>
          <Field label="Name"><input className="input" required disabled={form.isDefault} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>Weight per sq ft</span><input className="input" type="number" min="0" step="any" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Polish / paint step</span><select className="input" value={form.hasPolish ? 'Yes' : 'No'} onChange={(e) => setForm({ ...form, hasPolish: e.target.value === 'Yes' })}><option>No</option><option>Yes</option></select></label>
          </div>
          <div><h3>Tasks <span className="muted small">(points total {total})</span></h3>
            {form.tasks.map((t, i) => (
              <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
                <input className="input" aria-label="Task name" value={t.name} onChange={(e) => setForm({ ...form, tasks: form.tasks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className="input" style={{ width: 90 }} aria-label="Points" type="number" min="0" step="any" value={t.points} onChange={(e) => setForm({ ...form, tasks: form.tasks.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)) })} />
                <button type="button" className="btn btn-sm btn-danger" aria-label="Remove task" onClick={() => setForm({ ...form, tasks: form.tasks.filter((_, j) => j !== i) })}>✕</button>
              </div>))}
            <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, tasks: [...form.tasks, { name: '', points: 10 }] })}>Add task</button>
            <p className="muted small">Progress is stored per task by position, so reordering or removing tasks on a category that already has progress shifts what each saved value means.</p>
          </div>
          <div className="row"><button className="btn btn-primary">Save</button>
            {form.id && !form.isDefault && <button type="button" className="btn btn-danger" onClick={async () => { if (confirm('Delete this category?') && await act(() => deleteCategory(form.id), 'Deleted')) { setForm(null); reload() } }}>Delete</button>}</div>
        </form>
      </Modal>}
    </section>
  )
}

function Members() {
  const { user } = useAuth()
  const act = useAction()
  const [rows, setRows] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('site_team')
  const load = () => listMembers().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])
  return (
    <section className="card">
      <div className="card-head"><h2>Who has access</h2></div>
      <p className="muted small" style={{ marginTop: 0 }}>Accounts are created in the factory app's user management. Add an existing account here to give it Track access. Factory staff can already <b>view</b> progress from the factory dashboard without being added.</p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await act(() => setMember(email, role), 'Access saved')) { setEmail(''); load() } }}>
        <input className="input" style={{ flex: 2, minWidth: 200 }} type="email" required placeholder="email@company.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="input" style={{ flex: 1, minWidth: 130 }} aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}><option value="site_team">Site team</option><option value="admin">Admin</option></select>
        <button className="btn btn-primary">Add / update</button>
      </form>
      {rows === null ? <Loading /> : <table className="table" style={{ marginTop: 10 }}><tbody>{rows.map((m) => (
        <tr key={m.user_id}><td>{m.email}</td><td><span className="pill">{m.role === 'admin' ? 'Admin' : 'Site team'}</span></td>
          <td className="num">{m.user_id !== user.id && <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Remove ${m.email}?`) && await act(() => removeMember(m.user_id), 'Removed')) load() }}>Remove</button>}</td></tr>))}</tbody></table>}
    </section>
  )
}
