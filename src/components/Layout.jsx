import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { supabase } from '../lib/supabaseClient'
import GlobalSearch from './GlobalSearch'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/daily-log', label: 'Daily Log' },
  { to: '/projects', label: 'Projects' },
  { to: '/clients', label: 'Clients' },
  { to: '/job-work', label: 'Job Work' },
  { to: '/estimates', label: 'Estimates' },
  { to: '/billing', label: 'Billing', perm: 'billing' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/recurring-expenses', label: 'Recurring Expenses', perm: 'expense_manage' },
  { to: '/reports', label: 'Reports' },
  { to: '/statement', label: 'Income / Expense', perm: 'financial_reports' },
  { to: '/masters', label: 'Masters / Settings', perm: 'master_data' },
  { to: '/users', label: 'Users & Permissions', perm: 'user_manage' },
  { to: '/audit-log', label: 'Audit Log', perm: 'financial_reports' },
]

function NavItems({ onNavigate }) {
  const { hasPermission } = useAuth()
  return (
    <>
      {NAV.filter((n) => !n.perm || hasPermission(n.perm)).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm font-medium ${
              isActive ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100'
            }`
          }
        >
          {n.label}
        </NavLink>
      ))}
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
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-ink-200 bg-white h-screen sticky top-0 overflow-y-auto">
        <div className="px-4 py-4 border-b border-ink-100">
          <div className="font-semibold text-brand-700 leading-tight">Formgrid Factory</div>
          <div className="text-xs text-ink-400">Job-work &amp; billing</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavItems />
        </nav>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white p-3 overflow-y-auto">
            <div className="px-1 py-3 mb-2">
              <div className="font-semibold text-brand-700">Formgrid Factory</div>
            </div>
            <div className="px-1 mb-2">
              <GlobalSearch />
            </div>
            <nav className="space-y-1">
              <NavItems onNavigate={() => setMobileOpen(false)} />
            </nav>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white border-b border-ink-200 px-4 py-2.5 flex items-center justify-between">
          <button className="md:hidden btn-ghost px-2" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="md:hidden font-semibold text-brand-700">Formgrid Factory</div>
          <div className="hidden md:block flex-1 max-w-sm mx-4">
            <GlobalSearch />
          </div>
          <div className="relative md:ml-0 ml-auto">
            <button className="btn-ghost" onClick={() => setMenuOpen((o) => !o)}>
              <span className="font-medium text-ink-800">{profile?.full_name || 'Account'}</span>
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

        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
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
