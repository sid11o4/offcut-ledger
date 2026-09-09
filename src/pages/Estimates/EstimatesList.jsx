import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { useClients, useProjects, useRateCategories } from '../../lib/queries'
import { displayDate, today } from '../../lib/dates'
import { money } from '../../lib/format'

export default function EstimatesList() {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { profile, hasPermission } = useAuth()
  const [creating, setCreating] = useState(null)
  const canWrite = hasPermission('estimates')

  const estimatesQ = useQuery({
    queryKey: ['estimates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('estimates').select('*, clients(name), projects(name)').order('estimate_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const clients = (useClients().data || []).filter((c) => c.active)
  const projects = (useProjects().data || []).filter((p) => p.status !== 'cancelled')
  const categories = useRateCategories().data || []

  function startNew() {
    setCreating({ client_id: '', project_id: '', rate_category_id: '', validity_date: '', notes: '' })
  }

  function onClientChange(clientId) {
    const client = clients.find((c) => c.id === clientId)
    setCreating({ ...creating, client_id: clientId, rate_category_id: creating.rate_category_id || client?.default_rate_category_id || '' })
  }

  async function create(e) {
    e.preventDefault()
    const { data, error } = await supabase.from('estimates').insert({
      client_id: creating.client_id, project_id: creating.project_id || null, rate_category_id: creating.rate_category_id,
      validity_date: creating.validity_date || null, notes: creating.notes || null, created_by: profile?.id,
    }).select('id').single()
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['estimates'] })
    navigate(`/estimates/${data.id}`)
  }

  return (
    <div>
      <PageHeader
        title="Estimates"
        subtitle="Create an estimate before work begins, then compare against actuals as it's logged."
        actions={canWrite && <button className="btn-primary" onClick={startNew}>+ New Estimate</button>}
      />
      <Card>
        {estimatesQ.isLoading ? <LoadingBlock /> : !estimatesQ.data?.length ? (
          <EmptyState title="No estimates yet" hint={canWrite ? 'Use "+ New Estimate" to create one.' : undefined} />
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Estimate #</th><th>Date</th><th>Client</th><th>Project</th><th>Grand Total</th><th>Status</th></tr></thead>
              <tbody>
                {estimatesQ.data.map((e) => (
                  <tr key={e.id}>
                    <td><Link to={`/estimates/${e.id}`} className="text-brand-700 font-medium hover:underline">{e.estimate_number}</Link></td>
                    <td>{displayDate(e.estimate_date)}</td>
                    <td>{e.clients?.name}</td>
                    <td>{e.projects?.name || '—'}</td>
                    <td className="font-medium">{money(e.grand_total)}</td>
                    <td><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={create} className="card p-5 w-full max-w-md">
            <div className="text-sm font-semibold text-ink-900 mb-3">New Estimate</div>
            <div className="space-y-3">
              <div>
                <label className="field-label">Client *</label>
                <select className="field-input" required value={creating.client_id} onChange={(e) => onClientChange(e.target.value)}>
                  <option value="">Select…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Project <span className="text-ink-400 font-normal">(optional)</span></label>
                <select className="field-input" value={creating.project_id} onChange={(e) => setCreating({ ...creating, project_id: e.target.value })}>
                  <option value="">None</option>
                  {projects.filter((p) => !creating.client_id || p.client_id === creating.client_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Rate Category *</label>
                <select className="field-input" required value={creating.rate_category_id} onChange={(e) => setCreating({ ...creating, rate_category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Validity Date</label>
                <input className="field-input" type="date" min={today()} value={creating.validity_date} onChange={(e) => setCreating({ ...creating, validity_date: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setCreating(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Create &amp; Add Items →</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
