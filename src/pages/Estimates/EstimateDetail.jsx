import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { useJobWorkServices, useJobWorkComponents, useRates, useAppSettings } from '../../lib/queries'
import { serviceUnitRate } from '../../lib/calc'
import { money, qty } from '../../lib/format'
import { generateEstimatePdf } from '../../lib/pdf'

const NEXT_STATUSES = {
  draft: ['issued', 'cancelled'],
  issued: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: ['cancelled'],
  rejected: [],
  expired: [],
  cancelled: [],
}

export default function EstimateDetail() {
  const { id } = useParams()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('estimates')

  const servicesQ = useJobWorkServices()
  const componentsQ = useJobWorkComponents()
  const ratesQ = useRates()
  const settingsQ = useAppSettings()

  const estimateQ = useQuery({
    queryKey: ['estimate', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('estimates').select('*, clients(*), projects(*), rate_categories(name)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const itemsQ = useQuery({
    queryKey: ['estimate-items', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('estimate_items').select('*, job_work_services(name), units(name,code)').eq('estimate_id', id).order('sort_order')
      if (error) throw error
      return data
    },
  })

  const actualsQ = useQuery({
    queryKey: ['estimate-actuals', estimateQ.data?.project_id],
    enabled: Boolean(estimateQ.data?.project_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('service_id, base_quantity, total_amount')
        .eq('project_id', estimateQ.data.project_id)
        .eq('status', 'active')
      if (error) throw error
      const byService = new Map()
      for (const e of data) {
        const cur = byService.get(e.service_id) || { qty: 0, amount: 0 }
        cur.qty += Number(e.base_quantity); cur.amount += Number(e.total_amount)
        byService.set(e.service_id, cur)
      }
      return byService
    },
  })

  const [addingItem, setAddingItem] = useState(null)
  const estimate = estimateQ.data
  const items = itemsQ.data || []
  const editable = canWrite && estimate?.status === 'draft'
  const services = (servicesQ.data || []).filter((s) => s.active)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['estimate', id] })
    qc.invalidateQueries({ queryKey: ['estimate-items', id] })
    qc.invalidateQueries({ queryKey: ['estimates'] })
  }

  function startAddItem() {
    setAddingItem({ service_id: '', quantity: '', rate: '' })
  }

  function onServiceChange(serviceId) {
    const service = services.find((s) => s.id === serviceId)
    const rate = service ? serviceUnitRate(service, estimate.rate_category_id, estimate.estimate_date, servicesQ.data, componentsQ.data, ratesQ.data) : null
    setAddingItem({ ...addingItem, service_id: serviceId, rate: rate ?? '' })
  }

  async function saveItem(e) {
    e.preventDefault()
    const service = services.find((s) => s.id === addingItem.service_id)
    const { error } = await supabase.from('estimate_items').insert({
      estimate_id: id, service_id: addingItem.service_id, quantity: Number(addingItem.quantity),
      unit_id: service.unit_id, rate: Number(addingItem.rate), amount: Number(addingItem.quantity) * Number(addingItem.rate),
      sort_order: items.length,
    })
    if (error) return toast.error(error.message)
    setAddingItem(null)
    invalidate()
  }

  async function removeItem(itemId) {
    const ok = await confirm('Remove this line item?')
    if (!ok) return
    const { error } = await supabase.from('estimate_items').delete().eq('id', itemId)
    if (error) toast.error(error.message)
    else invalidate()
  }

  async function updateTax(taxPercent) {
    const { error } = await supabase.from('estimates').update({ tax_percent: Number(taxPercent) || 0 }).eq('id', id)
    if (error) toast.error(error.message)
    else invalidate()
  }

  async function changeStatus(status) {
    const ok = await confirm(`Change status to "${status}"?`, { tone: status === 'cancelled' ? 'danger' : 'primary', confirmLabel: 'Confirm' })
    if (!ok) return
    const { error } = await supabase.from('estimates').update({ status }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success(`Estimate ${status}.`); invalidate() }
  }

  function downloadPdf() {
    generateEstimatePdf({
      settings: settingsQ.data, estimate, client: estimate.clients, project: estimate.projects, rateCategory: estimate.rate_categories,
      items: items.map((it) => ({ service_name: it.job_work_services?.name, quantity: it.quantity, unit_name: it.units?.name, rate: it.rate, amount: it.amount })),
    })
  }

  if (estimateQ.isLoading) return <LoadingBlock />
  if (!estimate) return <EmptyState title="Estimate not found" />

  return (
    <div>
      <PageHeader
        title={estimate.estimate_number}
        subtitle={`${estimate.clients?.name} · ${estimate.projects?.name || 'No project linked'} · ${estimate.rate_categories?.name}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={estimate.status} />
            <button className="btn-secondary" onClick={downloadPdf}>Download PDF</button>
            {canWrite && (NEXT_STATUSES[estimate.status] || []).map((s) => (
              <button key={s} className={s === 'cancelled' ? 'btn-danger' : 'btn-primary'} onClick={() => changeStatus(s)}>
                Mark {s}
              </button>
            ))}
          </div>
        }
      />

      <Card title="Line Items" actions={editable && <button className="btn-primary text-xs" onClick={startAddItem}>+ Add Item</button>} className="mb-5">
        {!items.length ? <EmptyState title="No line items yet" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Job Work</th><th>Quantity</th><th>Unit</th><th>Rate</th><th>Amount</th>{editable && <th></th>}</tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.job_work_services?.name}</td>
                    <td>{qty(it.quantity)}</td>
                    <td>{it.units?.name}</td>
                    <td>{money(it.rate)}</td>
                    <td className="font-medium">{money(it.amount)}</td>
                    {editable && <td><button className="btn-ghost text-xs px-2 text-bad" onClick={() => removeItem(it.id)}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <div className="w-64 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(estimate.subtotal)}</span></div>
            <div className="flex justify-between items-center">
              <span>Tax %</span>
              {editable ? (
                <input type="number" step="0.01" defaultValue={estimate.tax_percent} onBlur={(e) => updateTax(e.target.value)} className="field-input w-20 py-1" />
              ) : <span>{estimate.tax_percent}%</span>}
            </div>
            <div className="flex justify-between"><span>Tax Amount</span><span>{money(estimate.tax_amount)}</span></div>
            <div className="flex justify-between font-semibold border-t border-ink-200 pt-1"><span>Grand Total</span><span>{money(estimate.grand_total)}</span></div>
          </div>
        </div>
      </Card>

      {estimate.project_id && (
        <Card title="Estimated vs Actual" className="mb-5">
          {actualsQ.isLoading ? <LoadingBlock /> : (
            <div className="overflow-x-auto -mx-4">
              <table className="table-base">
                <thead><tr><th>Job Work</th><th>Estimated Qty</th><th>Actual Qty</th><th>Remaining Qty</th><th>Estimated Value</th><th>Actual Value</th></tr></thead>
                <tbody>
                  {items.map((it) => {
                    const actual = actualsQ.data?.get(it.service_id) || { qty: 0, amount: 0 }
                    const remaining = Number(it.quantity) - actual.qty
                    return (
                      <tr key={it.id}>
                        <td>{it.job_work_services?.name}</td>
                        <td>{qty(it.quantity)}</td>
                        <td>{qty(actual.qty)}</td>
                        <td className={remaining < 0 ? 'text-bad' : ''}>{qty(remaining)}</td>
                        <td>{money(it.amount)}</td>
                        <td>{money(actual.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>Total</td><td></td><td></td><td></td>
                    <td>{money(estimate.subtotal)}</td>
                    <td>
                      {money(
                        items.reduce((s, it) => s + (actualsQ.data?.get(it.service_id)?.amount || 0), 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-400 mt-2">
            Actual figures reflect all logged work for this project against each estimated job-work, regardless of date —
            not merely what remains, since remaining is only meaningful once work has actually been logged against it.
          </p>
        </Card>
      )}

      {estimate.notes && <Card title="Notes"><p className="text-sm whitespace-pre-wrap">{estimate.notes}</p></Card>}

      {addingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveItem} className="card p-5 w-full max-w-sm">
            <div className="text-sm font-semibold text-ink-900 mb-3">Add Line Item</div>
            <div className="space-y-3">
              <div>
                <label className="field-label">Job Work *</label>
                <select className="field-input" required value={addingItem.service_id} onChange={(e) => onServiceChange(e.target.value)}>
                  <option value="">Select…</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="field-label">Quantity *</label><input className="field-input" type="number" min="0.0001" step="0.0001" required value={addingItem.quantity} onChange={(e) => setAddingItem({ ...addingItem, quantity: e.target.value })} /></div>
                <div><label className="field-label">Rate (₹) *</label><input className="field-input" type="number" min="0" step="0.01" required value={addingItem.rate} onChange={(e) => setAddingItem({ ...addingItem, rate: e.target.value })} /></div>
              </div>
              {addingItem.service_id && addingItem.rate === '' && <div className="text-xs text-bad">No current rate found — enter one manually.</div>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn-secondary" onClick={() => setAddingItem(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
