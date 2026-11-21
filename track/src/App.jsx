import { useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { loadProjects } from './lib/api'
import { useProject } from './lib/useProject'
import { ToastProvider, Loading } from './components/ui'
import Login from './components/Login'
import Overview from './pages/Overview'
import Plan from './pages/Plan'
import SiteLog from './pages/SiteLog'
import Materials from './pages/Materials'
import Admin from './pages/Admin'

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export default function App() {
  const { session, role, signOut, isAdmin } = useAuth()
  if (session === undefined) return <Loading />
  if (!session) return <Login />
  if (role === null) return <Loading />
  if (role === 'none') {
    return (
      <div className="login"><div className="card stack">
        <h1>No Track access yet</h1>
        <p className="muted">Your account is signed in but has not been given access to Track. Ask a Track admin to add you.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div></div>
    )
  }
  return <ToastProvider><Shell isAdmin={isAdmin} signOut={signOut} /></ToastProvider>
}

function Shell({ isAdmin, signOut }) {
  const [projects, setProjects] = useState(null)
  const [projectId, setProjectId] = useState(() => store.get('track.project'))
  const [tab, setTab] = useState(() => store.get('track.tab') || 'overview')

  async function refreshProjects() { setProjects(await loadProjects()) }
  useEffect(() => { refreshProjects().catch(() => setProjects([])) }, [])
  useEffect(() => {
    if (projects && projects.length && !projects.some((p) => p.id === projectId)) setProjectId(projects[0].id)
  }, [projects, projectId])
  useEffect(() => { if (projectId) store.set('track.project', projectId) }, [projectId])
  useEffect(() => { store.set('track.tab', tab) }, [tab])

  const project = projects?.find((p) => p.id === projectId) || null
  const data = useProject(project?.id)

  const tabs = [['overview', 'Overview'], ['plan', 'Rooms & BOQ'], ['log', 'Site log'], ['materials', 'Materials'], ...(isAdmin ? [['admin', 'Admin']] : [])]
  const page = projects === null ? <Loading /> : {
    overview: <Overview project={project} data={data} go={setTab} />,
    plan: <Plan project={project} data={data} isAdmin={isAdmin} />,
    log: <SiteLog project={project} data={data} />,
    materials: <Materials project={project} isAdmin={isAdmin} />,
    admin: <Admin projects={projects} refreshProjects={refreshProjects} data={data} />,
  }[tab]

  return (
    <div className="shell">
      <header className="topbar no-print">
        <div className="topbar-row">
          <div className="brand">FORMGRID <span>Track</span></div>
          <select className="input" style={{ maxWidth: 260, minHeight: 40 }} aria-label="Project" value={projectId || ''} onChange={(e) => setProjectId(e.target.value)}>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {projects && !projects.length && <option value="">No projects</option>}
          </select>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={signOut}>Sign out</button>
        </div>
        <nav className="tabs" aria-label="Sections">
          {tabs.map(([k, label]) => <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{label}</button>)}
        </nav>
      </header>
      <main>{page}</main>
    </div>
  )
}
