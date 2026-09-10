import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../components/ui'
import { useRoles, usePermissions } from '../lib/queries'

export default function UsersPermissions() {
  const [tab, setTab] = useState('users')

  return (
    <div>
      <PageHeader title="Users & Permissions" subtitle="Assign roles to users, and control what each role can do." />
      <div className="flex gap-1 mb-4 border-b border-ink-200">
        {['users', 'permissions'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500'}`}>{t}</button>
        ))}
      </div>
      {tab === 'users' ? <UsersTab /> : <PermissionsTab />}
    </div>
  )
}

function UsersTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { profile: me, refreshProfile } = useAuth()
  const rolesQ = useRoles()
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)

  const usersQ = useQuery({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*, roles(name, key)').order('full_name')
      if (error) throw error
      return data
    },
  })

  const adminRoleId = (rolesQ.data || []).find((r) => r.key === 'admin')?.id
  const activeAdmins = (usersQ.data || []).filter((u) => u.active && u.roles?.key === 'admin').length

  async function setRole(userId, roleId) {
    const { error } = await supabase.from('profiles').update({ role_id: roleId }).eq('id', userId)
    if (error) toast.error(error.message)
    else {
      toast.success('Role updated.')
      qc.invalidateQueries({ queryKey: ['profiles-all'] })
      if (userId === me?.id) refreshProfile?.()
    }
  }

  async function setActive(userId, active) {
    const { error } = await supabase.from('profiles').update({ active }).eq('id', userId)
    if (error) toast.error(error.message)
    else { toast.success(active ? 'Reactivated.' : 'Deactivated.'); qc.invalidateQueries({ queryKey: ['profiles-all'] }) }
  }

  async function invokeManageUser(payload) {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('manage-user', { body: payload })
    setBusy(false)
    const msg = error ? (await error.context?.json?.().then((b) => b?.error).catch(() => null)) || error.message : data?.error
    if (msg) { toast.error(msg); return false }
    return true
  }

  async function createUser(e) {
    e.preventDefault()
    const ok = await invokeManageUser({ action: 'create', email: adding.email, password: adding.password })
    if (!ok) return
    toast.success('User created with the Staff role. Assign their real role below.')
    setAdding(null)
    qc.invalidateQueries({ queryKey: ['profiles-all'] })
  }

  async function deleteUser(u) {
    const ok = await confirm(`Delete ${u.email}?`, {
      detail: 'Their login and profile are removed permanently. Their recorded work stays, attributed to a deleted user. This cannot be undone.',
      tone: 'danger', confirmLabel: 'Delete user',
    })
    if (!ok) return
    if (await invokeManageUser({ action: 'delete', userId: u.id })) {
      toast.success('User deleted.')
      qc.invalidateQueries({ queryKey: ['profiles-all'] })
    }
  }

  async function changeEmail(u) {
    const email = window.prompt(`New email for ${u.full_name || u.email}:`, u.email || '')
    if (!email || email === u.email) return
    if (await invokeManageUser({ action: 'set_email', userId: u.id, email })) {
      toast.success('Email updated.')
      qc.invalidateQueries({ queryKey: ['profiles-all'] })
      if (u.id === me?.id) refreshProfile?.()
    }
  }

  return (
    <Card
      title="Users"
      actions={<button className="btn-primary text-xs" disabled={busy} onClick={() => setAdding({ email: '', password: '' })}>+ Add User</button>}
    >
      <p className="text-xs text-ink-500 mb-3">
        Add a login here (it gets the least-privileged "Staff" role automatically), then set its real role. The last
        active admin can't be demoted, deactivated, or deleted — promote someone else to admin first.
      </p>
      {usersQ.isLoading ? <LoadingBlock /> : !usersQ.data?.length ? <EmptyState title="No users yet" /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {usersQ.data.map((u) => {
                const isSelf = u.id === me?.id
                const isLastAdmin = u.active && u.roles?.key === 'admin' && activeAdmins <= 1
                return (
                  <tr key={u.id} className={!u.active ? 'opacity-50' : ''}>
                    <td className="font-medium">{u.full_name || '—'} {isSelf && <Badge tone="ok">You</Badge>}</td>
                    <td className="text-xs">{u.email}</td>
                    <td>
                      <select
                        className="field-input py-1 w-auto"
                        value={u.role_id || ''}
                        disabled={isLastAdmin}
                        onChange={(e) => setRole(u.id, e.target.value)}
                      >
                        {(rolesQ.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs px-2" onClick={() => changeEmail(u)}>Change email</button>
                      <button
                        className="btn-ghost text-xs px-2"
                        disabled={isLastAdmin}
                        onClick={() => setActive(u.id, !u.active)}
                      >
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      {!isSelf && (
                        <button className="btn-ghost text-xs px-2 text-bad" disabled={isLastAdmin} onClick={() => deleteUser(u)}>Delete</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={createUser} className="card p-5 w-full max-w-sm">
            <div className="text-sm font-semibold text-ink-900 mb-3">Add User</div>
            <div className="space-y-3">
              <div>
                <label className="field-label">Email *</label>
                <input className="field-input" type="email" required value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Temporary password * <span className="text-ink-400 font-normal">(min 8 chars — they change it after first login)</span></label>
                <input className="field-input" type="text" minLength={8} required value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}
    </Card>
  )
}

function PermissionsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const rolesQ = useRoles()
  const permsQ = usePermissions()

  const matrixQ = useQuery({
    queryKey: ['role_permissions_matrix'],
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('*')
      if (error) throw error
      const map = {}
      for (const r of data) map[`${r.role_id}::${r.permission_key}`] = r.allowed
      return map
    },
  })

  async function toggle(roleId, permKey, current) {
    const { error } = await supabase
      .from('role_permissions')
      .update({ allowed: !current })
      .eq('role_id', roleId)
      .eq('permission_key', permKey)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['role_permissions_matrix'] })
  }

  const roles = rolesQ.data || []
  const perms = permsQ.data || []

  return (
    <Card title="Permission Matrix">
      <p className="text-xs text-ink-500 mb-3">
        The role set (Admin, Manager, Factory Staff, Accounts) is fixed, but exactly what each role can do is fully
        configurable here — enforced server-side, not just hidden in the UI.
      </p>
      {rolesQ.isLoading || permsQ.isLoading || matrixQ.isLoading ? <LoadingBlock /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead>
              <tr><th>Permission</th>{roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.key}>
                  <td className="font-medium">{p.label}<div className="text-xs text-ink-400 font-normal">{p.description}</div></td>
                  {roles.map((r) => {
                    const allowed = matrixQ.data?.[`${r.id}::${p.key}`]
                    return (
                      <td key={r.id} className="text-center">
                        <input type="checkbox" checked={Boolean(allowed)} onChange={() => toggle(r.id, p.key, allowed)} disabled={r.key === 'admin'} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
