import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../components/ui'
import { displayDateTime } from '../lib/dates'

const TABLES = [
  'rates', 'job_work_entries', 'projects', 'clients', 'bills', 'estimates', 'expenses',
  'recurring_expenses', 'machines', 'processes', 'units', 'job_work_services',
  'rate_categories', 'expense_categories', 'role_permissions', 'profiles',
]

export default function AuditLog() {
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [page, setPage] = useState(0)
  const pageSize = 40

  const logQ = useQuery({
    queryKey: ['audit_logs', table, action, page],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*, profiles(full_name)').order('changed_at', { ascending: false })
      if (table) q = q.eq('table_name', table)
      if (action) q = q.eq('action', action)
      q = q.range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const rows = logQ.data || []

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who changed what, and when — append-only." />

      <Card className="mb-4">
        <div className="flex flex-wrap gap-3">
          <select className="field-input w-auto" value={table} onChange={(e) => { setTable(e.target.value); setPage(0) }}>
            <option value="">All tables</option>
            {TABLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="field-input w-auto" value={action} onChange={(e) => { setAction(e.target.value); setPage(0) }}>
            <option value="">All actions</option>
            <option value="INSERT">Insert</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
          </select>
        </div>
      </Card>

      <Card>
        {logQ.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyState title="No audit entries" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>When</th><th>User</th><th>Table</th><th>Action</th><th>Record</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <>
                    <tr key={r.id}>
                      <td>{displayDateTime(r.changed_at)}</td>
                      <td>{r.profiles?.full_name || <span className="text-ink-400">System</span>}</td>
                      <td className="font-mono text-xs">{r.table_name}</td>
                      <td><Badge tone={r.action === 'INSERT' ? 'ok' : r.action === 'DELETE' ? 'bad' : 'warn'}>{r.action}</Badge></td>
                      <td className="font-mono text-xs">{r.record_id?.slice(0, 8) || '—'}</td>
                      <td><button className="btn-ghost text-xs px-2" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? 'Hide' : 'Details'}</button></td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td colSpan={6} className="bg-ink-50">
                          <div className="grid md:grid-cols-2 gap-3 p-2 text-xs">
                            {r.old_values && (
                              <div><div className="font-semibold mb-1">Before</div><pre className="whitespace-pre-wrap break-all bg-white p-2 rounded border border-ink-200">{JSON.stringify(r.old_values, null, 2)}</pre></div>
                            )}
                            {r.new_values && (
                              <div><div className="font-semibold mb-1">After</div><pre className="whitespace-pre-wrap break-all bg-white p-2 rounded border border-ink-200">{JSON.stringify(r.new_values, null, 2)}</pre></div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</button>
          <button className="btn-secondary" disabled={rows.length < pageSize} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      </Card>
    </div>
  )
}
