import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { supabase } from '../lib/supabaseClient'
import GlobalSearch from './GlobalSearch'
import Icon from './icons'

// Icon rail (design-taste-frontend, app-screens §3/§4): an unlabelled 56px rail, grouped by
// 20px hairlines, the active item marked by a plain tint -- no coloured pills, no left bar.
// More destinations than the study ever tested, so the rail scrolls; each icon still carries a
// tooltip and an accessible name per the house rule.
const GROUPS = [
  { items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }] },
  {
    label: 'Factory',
    items: [
      { to: '/daily-log', label: 'Daily Log', icon: 'log' },
      { to: '/job-work', label: 'Job Work Catalog', icon: 'tool' },
      { to: '/projects', label: 'Projects', icon: 'project' },
      { to: '/clients', label: 'Clients', icon: 'client' },
      { to: '/estimates', label: 'Estimates', icon: 'estimate' },
      { to: '/billing', label: 'Billing', icon: 'bill', perm: 'billing' },
      { to: '/expenses', label: 'Expenses', icon: 'wallet' },
      { to: '/recurring-expenses', label: 'Recurring Expenses', icon: 'recur', perm: 'expense_manage' },
      { to: '/reports', label: 'Reports', icon: 'report' },
      { to: '/statement', label: 'Income / Expense', icon: 'statement', perm: 'financial_reports' },
    ],
  },
  {
    label: 'Design Build',
    items: [
      { to: '/design-build/projects', label: 'Design Build Projects', icon: 'layers', perm: 'design_build_manage' },
      { to: '/design-build/inventory', label: 'Company Inventory', icon: 'inventory', perm: 'inventory_operate' },
      { to: '/design-build/slip', label: 'Consumption / Transfer Slip', icon: 'transfer', perm: 'inventory_operate' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/accounts', label: 'Accounts Overview', icon: 'queue', perm: 'supplier_bills_manage' },
      { to: '/accounts/bills', label: 'Bill Audit Queue', icon: 'bill', perm: 'supplier_bills_manage' },
      { to: '/accounts/bank', label: 'Bank Reconciliation', icon: 'bank', perm: 'bank_reconciliation' },
      { to: '/accounts/gst', label: 'GST Follow-up', icon: 'compliance', perm: 'gst_compliance' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/masters', label: 'Masters / Settings', icon: 'settings', perm: 'master_data' },
      { to: '/users', label: 'Users & Permissions', icon: 'users', perm: 'user_manage' },
      { to: '/audit-log', label: 'Audit Log', icon: 'history', perm: 'financial_reports' },
    ],
  },
]

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

function RailGroups({ onNavigate, labelled }) {
  const { hasPermission } = useAuth()
  return (
    <>
      {GROUPS.map((g, i) => {
        const visible = g.items.filter((n) => !n.perm || hasPermission(n.perm))
        if (!visible.length) return null
        return (
          <div key={i} className={`flex flex-col items-center gap-1 ${labelled ? 'items-stretch' : ''} ${i > 0 ? 'mt-2 pt-2 border-t border-ink-800' : ''}`}>
            {labelled && g.label && <div className="px-3 pb-1 text-xs text-ink-500">{g.label}</div>}
            {visible.map((item) => <RailLink key={item.to} item={item} onNavigate={onNavigate} labelled={labelled} />)}
          </div>
        )
      })}
    </>
  )
}

export default function Layout() {
  const { profile, roleName, signOut } = useAuth()
  const toast = useToast()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)

  return (
    <div className="min-h-screen flex bg-ink-50">
      <aside className="hidden md:flex md:flex-col w-14 shrink-0 bg-ink-950 h-screen sticky top-0 overflow-y-auto py-3">
        <div className="flex justify-center mb-2">
          <div className="w-8 h-8 rounded-md bg-brand-600 text-white flex items-center justify-center font-semibold text-sm">F</div>
        </div>
        <nav className="flex-1 flex flex-col items-center [&_.rail-item]:text-ink-400 [&_.rail-item:hover]:text-white [&_.rail-item:hover]:bg-white/10 [&_.rail-item.active]:text-white [&_.rail-item.active]:bg-white/10">
          <RailGroups />
        </nav>
      </aside>

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
              <RailGroups onNavigate={() => setMobileOpen(false)} labelled />
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
          <div className="hidden md:block flex-1 max-w-sm">
            <GlobalSearch />
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
          <Outlet />
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
