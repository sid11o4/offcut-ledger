import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { supabase } from '../lib/supabaseClient'
import GlobalSearch from './GlobalSearch'
import AskBar from './AskBar'
import Icon from './icons'

// Icon rail (design-taste-frontend, app-screens §3/§4): an unlabelled 56px rail, grouped by
// 20px hairlines, the active item marked by a plain tint -- no coloured pills, no left bar.
// More destinations than the study ever tested, so the rail scrolls; each icon still carries a
// tooltip and an accessible name per the house rule.
//
// Factory and Design Build are two different businesses sharing one app (owner's framing). The top
// of the sidebar is only the workspace switch; choosing a workspace opens its dashboard and shows
// its own menu, so each business has its own home and nothing from the other is on screen. Admin
// sits outside the switch: Masters, Users and Audit Log are shared back-office.
const WORKSPACES = [
  { key: 'factory', label: 'Factory', icon: 'project', home: '/' },
  { key: 'design_build', label: 'Design Build', icon: 'layers', home: '/design-build' },
]

const WORKSPACE_GROUPS = {
  factory: [
    {
      label: 'Factory',
      items: [
        { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
        { to: '/daily-log', label: 'Daily Log', icon: 'log' },
        { to: '/job-work', label: 'Job Work Catalog', icon: 'tool' },
        { to: '/projects', label: 'Projects', icon: 'project' },
        { to: '/clients', label: 'Clients', icon: 'client' },
        { to: '/estimates', label: 'Estimates', icon: 'estimate' },
        { to: '/billing', label: 'Billing', icon: 'bill', perm: 'billing' },
        { to: '/expenses', label: 'Expenses', icon: 'wallet' },
        { to: '/recurring-expenses', label: 'Recurring Expenses', icon: 'recur', perm: 'expense_manage' },
      ],
    },
    {
      label: 'Reports',
      items: [
        { to: '/reports', label: 'Reports', icon: 'report' },
        { to: '/ledger', label: 'Ledger', icon: 'ledger', perm: 'financial_reports' },
        { to: '/statement', label: 'Income / Expense', icon: 'statement', perm: 'financial_reports' },
      ],
    },
  ],
  // Same menu shape as Factory. Projects, Clients, Job Work, Estimates, Billing and the Daily Log are
  // shared pages, so they appear here too; Expenses, Recurring Expenses and the ledger/statement are
  // Design Build's own.
  design_build: [
    {
      label: 'Design Build',
      items: [
        { to: '/design-build', label: 'Dashboard', icon: 'dashboard', perm: 'design_build_manage', end: true },
        { to: '/daily-log', label: 'Daily Log', icon: 'log' },
        { to: '/job-work', label: 'Job Work Catalog', icon: 'tool' },
        { to: '/projects', label: 'Projects', icon: 'project' },
        { to: '/clients', label: 'Clients', icon: 'client' },
        { to: '/estimates', label: 'Estimates', icon: 'estimate' },
        { to: '/billing', label: 'Billing', icon: 'bill', perm: 'billing' },
        { to: '/design-build/expenses', label: 'Expenses', icon: 'wallet', perm: 'design_build_manage' },
        { to: '/design-build/recurring-expenses', label: 'Recurring Expenses', icon: 'recur', perm: 'design_build_manage' },
        { to: '/design-build/inventory', label: 'Company Inventory', icon: 'inventory', perm: 'inventory_operate' },
        { to: '/design-build/slip', label: 'Consumption / Transfer Slip', icon: 'transfer', perm: 'inventory_operate' },
      ],
    },
    // Each subheader is its own group, so the expanded rail shows it as a heading over its reports.
    {
      label: 'Ledgers',
      items: [
        { to: '/design-build/ledger', label: 'Ledger & Statement', icon: 'ledger', perm: 'supplier_bills_manage' },
      ],
    },
    {
      label: 'Project reports',
      items: [
        { to: '/design-build/reports/projects', label: 'Project summary', icon: 'layers', perm: 'design_build_manage' },
        { to: '/design-build/reports/consolidated', label: 'Consolidated report', icon: 'report', perm: 'design_build_manage' },
      ],
    },
    {
      label: 'Suppliers & contractors',
      items: [
        { to: '/design-build/suppliers', label: 'Statements', icon: 'users', perm: 'supplier_bills_manage' },
      ],
    },
    {
      label: 'Expense reports',
      items: [
        { to: '/design-build/reports/expenses', label: 'By category', icon: 'wallet', perm: 'design_build_manage' },
      ],
    },
    {
      label: 'Material & labour reports',
      items: [
        { to: '/design-build/reports/materials', label: 'Materials consumed', icon: 'inventory', perm: 'design_build_manage' },
        { to: '/design-build/reports/labour', label: 'Labour', icon: 'tool', perm: 'design_build_manage' },
      ],
    },
    {
      label: 'Accounts',
      items: [
        { to: '/accounts', label: 'Accounts Overview', icon: 'queue', perm: 'supplier_bills_manage', end: true },
        { to: '/accounts/bills', label: 'Bill Audit Queue', icon: 'bill', perm: 'supplier_bills_manage' },
        { to: '/accounts/bank', label: 'Bank Reconciliation', icon: 'bank', perm: 'bank_reconciliation' },
        { to: '/accounts/gst', label: 'GST Follow-up', icon: 'compliance', perm: 'gst_compliance' },
      ],
    },
  ],
}

const ADMIN_GROUP = {
  label: 'Admin',
  items: [
    { to: '/masters', label: 'Masters / Settings', icon: 'settings', perm: 'master_data' },
    { to: '/users', label: 'Users & Permissions', icon: 'users', perm: 'user_manage' },
    { to: '/audit-log', label: 'Audit Log', icon: 'history', perm: 'financial_reports' },
  ],
}

// The workspace that owns this path. The current workspace is checked first, so a shared page keeps
// the menu the user is already in.
function workspaceForPath(pathname, preferred) {
  const order = [preferred, ...Object.keys(WORKSPACE_GROUPS).filter((k) => k !== preferred)]
  for (const key of order) {
    const groups = WORKSPACE_GROUPS[key]
    if (!groups) continue
    for (const g of groups) {
      if (g.items.some((item) => pathname === item.to || pathname.startsWith(item.to + '/'))) return key
    }
  }
  return null
}

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch { /* private browsing or storage disabled -- just don't persist */ }
}

function RailLink({ item, onNavigate, labelled }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={item.label}
      className={({ isActive }) => `rail-item ${isActive ? 'active' : ''} ${labelled ? '!w-full !justify-start gap-2.5 px-3' : ''}`}
    >
      <Icon name={item.icon} />
      {labelled && <span className="text-sm font-medium">{item.label}</span>}
      <span className="sr-only">{item.label}</span>
    </NavLink>
  )
}

function RailGroups({ groups, onNavigate, labelled, firstBordered = false }) {
  const { hasPermission } = useAuth()
  return (
    <>
      {groups.map((g, i) => {
        const visible = g.items.filter((n) => !n.perm || hasPermission(n.perm))
        if (!visible.length) return null
        return (
          <div key={g.label || i} className={`flex flex-col items-center gap-1 ${labelled ? 'items-stretch' : ''} ${i > 0 || firstBordered ? 'mt-2 pt-2 border-t border-ink-800' : ''}`}>
            {labelled && g.label && <div className="px-3 pb-1 text-xs text-ink-500">{g.label}</div>}
            {visible.map((item) => <RailLink key={item.to} item={item} onNavigate={onNavigate} labelled={labelled} />)}
          </div>
        )
      })}
    </>
  )
}

// Segmented control between the two businesses -- icon rail. Plain tint for the active one,
// same as every other rail item, never a coloured pill.
function WorkspaceSwitcher({ workspace, onChange, labelled }) {
  return (
    <div className={`flex flex-col items-center gap-1 ${labelled ? 'items-stretch' : ''} pb-2 mb-1 border-b border-ink-800`}>
      {WORKSPACES.map((w) => (
        <button
          key={w.key}
          type="button"
          onClick={() => onChange(w.key)}
          title={w.label}
          className={`rail-item ${workspace === w.key ? 'active' : ''} ${labelled ? '!w-full !justify-start gap-2.5 px-3' : ''}`}
        >
          <Icon name={w.icon} />
          {labelled && <span className="text-sm font-medium">{w.label}</span>}
          <span className="sr-only">{w.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function Layout() {
  const { profile, roleName, signOut } = useAuth()
  const toast = useToast()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [workspace, setWorkspace] = useState(() => readStored('formgrid_workspace', 'factory'))
  const [railExpanded, setRailExpanded] = useState(() => readStored('formgrid_rail_expanded', '') === '1')
  const location = useLocation()
  const navigate = useNavigate()

  // A direct link or browser-back into a page that belongs to the other workspace should show
  // that page's own nav item highlighted, not leave the rail stuck on whichever workspace was
  // last picked by hand -- otherwise the active route silently disappears from the visible
  // menu. Derived from WORKSPACE_GROUPS itself so the two stay in sync automatically.
  // Shared pages (Projects, Clients, Daily Log) sit in both menus, so only switch workspace when the
  // current one does not already own this route.
  useEffect(() => {
    const match = workspaceForPath(location.pathname, workspace)
    if (match) setWorkspace((w) => (w === match ? w : match))
  }, [location.pathname])

  // Picking a workspace opens its dashboard, so the page and the menu always describe the same
  // business.
  function changeWorkspace(key) {
    setWorkspace(key)
    writeStored('formgrid_workspace', key)
    navigate(WORKSPACES.find((w) => w.key === key).home)
  }
  function toggleRail() {
    setRailExpanded((v) => {
      writeStored('formgrid_rail_expanded', v ? '' : '1')
      return !v
    })
  }

  const activeGroups = WORKSPACE_GROUPS[workspace]

  return (
    <div className="min-h-screen flex bg-ink-50">
      {/* The sidebar and its edge handle share a wrapper, so the handle can sit on the sidebar's right
          edge without being clipped by the sidebar's own scroll area. */}
      <div className="hidden md:block relative shrink-0 h-screen sticky top-0">
        <aside className={`flex flex-col h-full ${railExpanded ? 'w-56' : 'w-14'} bg-ink-950 overflow-y-auto py-3 transition-[width] duration-150`}>
          <div className={`flex mb-2 ${railExpanded ? 'px-3 items-center gap-2' : 'justify-center'}`}>
            <div className="w-8 h-8 shrink-0 rounded-md bg-brand-600 text-white flex items-center justify-center font-semibold text-sm">F</div>
            {railExpanded && <span className="font-medium text-white text-sm">Formgrid</span>}
          </div>
          <nav className="flex-1 flex flex-col items-center [&_.rail-item]:text-ink-400 [&_.rail-item:hover]:text-white [&_.rail-item:hover]:bg-white/10 [&_.rail-item.active]:text-white [&_.rail-item.active]:bg-white/10">
            <WorkspaceSwitcher workspace={workspace} onChange={changeWorkspace} labelled={railExpanded} />
            <RailGroups groups={activeGroups} labelled={railExpanded} />
            <RailGroups groups={[ADMIN_GROUP]} labelled={railExpanded} firstBordered />
          </nav>
        </aside>
        {/* Edge handle: click it on the sidebar's right edge to open or close the sidebar. Always visible. */}
        <button
          type="button"
          onClick={toggleRail}
          title={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={railExpanded}
          className="absolute top-1/2 -translate-y-1/2 -right-3 z-30 w-6 h-12 rounded-md bg-ink-950 border border-ink-700 text-ink-300 hover:text-white hover:bg-ink-800 flex items-center justify-center shadow-sm transition-colors"
        >
          <Icon name="chevron" className={railExpanded ? 'rotate-180' : ''} />
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-ink-950 p-3 overflow-y-auto">
            <div className="flex items-center justify-between px-1 py-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-brand-600 text-white flex items-center justify-center font-semibold text-xs">F</div>
                <span className="font-medium text-white text-sm">Formgrid</span>
              </div>
              <button className="text-ink-400 p-1" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <Icon name="close" />
              </button>
            </div>
            <div className="px-1 mb-3">
              <GlobalSearch />
            </div>
            <nav className="[&_.rail-item]:text-ink-300 [&_.rail-item:hover]:text-white [&_.rail-item:hover]:bg-white/10 [&_.rail-item.active]:text-white [&_.rail-item.active]:bg-white/10">
              <WorkspaceSwitcher workspace={workspace} onChange={changeWorkspace} labelled />
              <RailGroups groups={activeGroups} onNavigate={() => setMobileOpen(false)} labelled />
              <RailGroups groups={[ADMIN_GROUP]} onNavigate={() => setMobileOpen(false)} labelled firstBordered />
            </nav>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-ink-50/95 backdrop-blur-sm border-b border-ink-200 px-4 py-2.5 flex items-center justify-between">
          <button className="md:hidden btn-ghost px-2" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="md:hidden font-medium text-ink-950">Formgrid</div>
          <div className="hidden md:block flex-1 max-w-xl">
            <AskBar />
          </div>
          <div className="relative md:ml-0 ml-auto">
            <button className="btn-ghost" onClick={() => setMenuOpen((o) => !o)}>
              <span className="font-medium text-ink-900">{profile?.full_name || 'Account'}</span>
              <span className="text-ink-400 text-xs">({roleName || '—'})</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 card p-1 z-40" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-ink-100"
                  onClick={() => { setPwOpen(true); setMenuOpen(false) }}
                >
                  Change password
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-ink-100 text-bad"
                  onClick={signOut}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-[1280px] w-full mx-auto">
          {/* Keyed on the route, so every page enters with the same short, eased rise. */}
          <div key={location.pathname} className="page-in">
            <Outlet />
          </div>
        </main>
      </div>

      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} toast={toast} />}
    </div>
  )
}

function ChangePasswordDialog({ onClose, toast }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) toast.error(error.message)
    else {
      toast.success('Password updated.')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-sm">
        <div className="text-sm font-semibold text-ink-900 mb-3">Change password</div>
        <input
          type="password"
          autoFocus
          minLength={8}
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password (min 8 characters)"
          className="field-input"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">Update</button>
        </div>
      </form>
    </div>
  )
}
