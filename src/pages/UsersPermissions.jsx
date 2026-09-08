import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
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
  const qc = useQueryClient()
  const { profile: me } = useAuth()
  const rolesQ = useRoles()

  const usersQ = useQuery({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*, roles(name)').order('full_name')
      if (error) throw error
      return data
    },
  })

  async function setRole(userId, roleId) {
    const { error } = await supabase.from('profiles').update({ role_id: roleId }).eq('id', userId)
    if (error) toast.error(error.message)
    else { toast.success('Role updated.'); qc.invalidateQueries({ queryKey: ['profiles-all'] }) }
  }

  async function setActive(userId, active) {
    const { error } = await supabase.from('profiles').update({ active }).eq('id', userId)
    if (error) toast.error(error.message)
    else { toast.success(active ? 'Reactivated.' : 'Deactivated.'); qc.invalidateQueries({ queryKey: ['profiles-all'] }) }
  }

  return (
    <Card title="Users">
      <p className="text-xs text-ink-500 mb-3">
        New logins are provisioned in the Supabase dashboard (Authentication → Users → Invite user) — they get the
        least-privileged "Staff" role automatically, then you assign the correct role here.
      </p>
      {usersQ.isLoading ? <LoadingBlock /> : !usersQ.data?.length ? <EmptyState title="No users yet" /> : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {usersQ.data.map((u) => (
                <tr key={u.id} className={!u.active ? 'opacity-50' : ''}>
                  <td className="font-medium">{u.full_name || '—'}</td>
                  <td className="text-xs">{u.email}</td>
                  <td>
                    <select
                      className="field-input py-1 w-auto"
                      value={u.role_id || ''}
                      disabled={u.id === me?.id}
                      onChange={(e) => setRole(u.id, e.target.value)}
                    >
                      {(rolesQ.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.id === me?.id ? (
                      <Badge tone="ok">You</Badge>
                    ) : (
                      <button className="btn-ghost text-xs px-2" onClick={() => setActive(u.id, !u.active)}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
