import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { useJobWorkServices, useRateCategories, useRates } from '../../lib/queries'
import { displayDate, today } from '../../lib/dates'
import { money } from '../../lib/format'

export default function RatesTab() {
  const servicesQ = useJobWorkServices()
  const categoriesQ = useRateCategories()
  const ratesQ = useRates()
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [adding, setAdding] = useState(null)

  const atomicServices = (servicesQ.data || []).filter((s) => !s.is_composite)
  const rates = ratesQ.data || []

  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of rates) {
      const key = `${r.job_work_service_id}::${r.rate_category_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
    return map
  }, [rates])

  function serviceName(id) { return atomicServices.find((s) => s.id === id)?.name || '—' }
  function categoryName(id) { return (categoriesQ.data || []).find((c) => c.id === id)?.name || '—' }
  function unitName(id) {
    const s = atomicServices.find((x) => x.id === id)
    return s?.units?.name || ''
  }

  function startNew() {
    setAdding({ job_work_service_id: '', rate_category_id: '', rate: '', effective_from: today(), notes: '' })
  }

  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('rates').insert({
      job_work_service_id: adding.job_work_service_id,
      rate_category_id: adding.rate_category_id,
      rate: Number(adding.rate),
      effective_from: adding.effective_from,
      notes: adding.notes || null,
      created_by: profile?.id,
    })
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Rate saved. Any previous open-ended rate for this service/category was automatically closed the day before.')
    setAdding(null)
    qc.invalidateQueries({ queryKey: ['rates'] })
  }

  const isLoading = servicesQ.isLoading || categoriesQ.isLoading || ratesQ.isLoading

  return (
    <Card title="Rate Master" actions={<button className="btn-primary" onClick={startNew}>+ Add Rate</button>}>
      <p className="text-xs text-ink-500 mb-3">
        Rates apply to atomic (rate-bearing) job-work items only. Adding a new rate automatically closes any existing
        open-ended rate for the same job-work + rate category the day before the new one starts — history is preserved,
        never overwritten.
      </p>
      {isLoading ? (
        <LoadingBlock />
      ) : !grouped.size ? (
        <EmptyState title="No rates configured yet" />
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="table-base">
            <thead>
              <tr><th>Job Work</th><th>Rate Category</th><th>Rate</th><th>Effective From</th><th>Effective To</th></tr>
            </thead>
            <tbody>
              {[...grouped.values()].map((versions) => (
                versions.map((r, i) => (
                  <tr key={r.id}>
                    {i === 0 && <td rowSpan={versions.length} className="font-medium align-top border-r border-ink-100">{serviceName(r.job_work_service_id)} <span className="text-ink-400 text-xs">/ {unitName(r.job_work_service_id)}</span></td>}
                    {i === 0 && <td rowSpan={versions.length} className="align-top border-r border-ink-100">{categoryName(r.rate_category_id)}</td>}
                    <td>{money(r.rate)}</td>
                    <td>{displayDate(r.effective_from)}</td>
                    <td>{r.effective_to ? displayDate(r.effective_to) : <Badge tone="ok">Current</Badge>}</td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="card p-5 w-full max-w-md">
            <div className="text-sm font-semibold text-ink-900 mb-3">Add Rate</div>
            <div className="space-y-3">
              <div>
                <label className="field-label">Job Work (atomic) *</label>
                <select className="field-input" required value={adding.job_work_service_id} onChange={(e) => setAdding({ ...adding, job_work_service_id: e.target.value })}>
                  <option value="">Select…</option>
                  {atomicServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Rate Category *</label>
                <select className="field-input" required value={adding.rate_category_id} onChange={(e) => setAdding({ ...adding, rate_category_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(categoriesQ.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Rate (₹) *</label>
                  <input className="field-input" type="number" min="0" step="0.01" required value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">Effective From *</label>
                  <input className="field-input" type="date" required value={adding.effective_from} onChange={(e) => setAdding({ ...adding, effective_from: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="field-label">Notes</label>
                <textarea className="field-input" rows={2} value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </Card>
  )
}
