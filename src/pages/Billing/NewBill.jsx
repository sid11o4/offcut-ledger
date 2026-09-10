import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, EmptyState, LoadingBlock } from '../../components/ui'
import { useProjects, useAppSettings } from '../../lib/queries'
import { GST_TREATMENTS, computeGst } from '../../lib/gst'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

export default function NewBill() {
  const navigate = useNavigate()
  const toast = useToast()
  const projectsQ = useProjects()
  const settingsQ = useAppSettings()
  const [projectId, setProjectId] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [taxPercent, setTaxPercent] = useState('')
  const [gstTreatment, setGstTreatment] = useState('full')
  const [adjustments, setAdjustments] = useState('0')
  const [adjustmentNotes, setAdjustmentNotes] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const projects = (projectsQ.data || []).filter((p) => p.status !== 'cancelled')

  const entriesQ = useQuery({
    queryKey: ['unbilled-entries', projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('*, job_work_services(name), units(code)')
        .eq('project_id', projectId).eq('status', 'active').eq('billed', false)
        .order('entry_date')
      if (error) throw error
      setSelected(new Set(data.map((e) => e.id)))
      return data
    },
  })

  const entries = entriesQ.data || []
  const selectedEntries = entries.filter((e) => selected.has(e.id))
  const subtotal = selectedEntries.reduce((s, e) => s + Number(e.total_amount), 0)
  const nominalPct = taxPercent === '' ? Number(settingsQ.data?.default_tax_percent || 0) : Number(taxPercent)
  const gst = computeGst(subtotal, nominalPct, gstTreatment)
  const grandTotal = subtotal + gst.total + (Number(adjustments) || 0)

  const period = useMemo(() => {
    if (!selectedEntries.length) return [null, null]
    const dates = selectedEntries.map((e) => e.entry_date).sort()
    return [dates[0], dates[dates.length - 1]]
  }, [selectedEntries])

  function toggle(id) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  async function generate() {
    if (!selected.size) return toast.error('Select at least one entry to bill.')
    setSaving(true)
    const { data, error } = await supabase.rpc('generate_bill', {
      p_project_id: projectId, p_entry_ids: [...selected],
      p_billing_period_start: period[0], p_billing_period_end: period[1],
      p_tax_percent: nominalPct, p_gst_treatment: gstTreatment, p_adjustments: Number(adjustments) || 0,
      p_adjustment_notes: adjustmentNotes || null, p_notes: notes || null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Bill generated.')
    navigate(`/billing/${data}`)
  }

  return (
    <div>
      <PageHeader title="New Bill" subtitle="Select a project, then choose which unbilled work to include." />

      <Card className="mb-5">
        <label className="field-label">Project *</label>
        <select className="field-input max-w-md" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Select project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.clients?.name})</option>)}
        </select>
      </Card>

      {projectId && (
        <Card title="Unbilled Job Work" className="mb-5">
          {entriesQ.isLoading ? <LoadingBlock /> : !entries.length ? <EmptyState title="No unbilled work for this project" /> : (
            <div className="overflow-x-auto -mx-4">
              <table className="table-base">
                <thead><tr><th></th><th>Date</th><th>Job Work</th><th>Qty</th><th>Amount</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} /></td>
                      <td>{displayDate(e.entry_date)}</td>
                      <td>{e.job_work_services?.name}</td>
                      <td>{qty(e.base_quantity)} {e.units?.code}</td>
                      <td className="font-medium">{money(e.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {projectId && entries.length > 0 && (
        <Card title="Bill Summary">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="field-label">GST rate % <span className="text-ink-400 font-normal">(statutory — default {settingsQ.data?.default_tax_percent ?? 0}%)</span></label>
                <input className="field-input" type="number" step="0.01" placeholder={String(settingsQ.data?.default_tax_percent ?? 0)} value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
              </div>
              <div>
                <label className="field-label">GST treatment</label>
                <select className="field-input" value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value)}>
                  {GST_TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div><label className="field-label">Adjustments (₹)</label><input className="field-input" type="number" step="0.01" value={adjustments} onChange={(e) => setAdjustments(e.target.value)} /></div>
              {Number(adjustments) !== 0 && <div><label className="field-label">Adjustment Notes</label><input className="field-input" value={adjustmentNotes} onChange={(e) => setAdjustmentNotes(e.target.value)} /></div>}
              <div><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Selected entries</span><span>{selected.size}</span></div>
              <div className="flex justify-between"><span>Period</span><span>{period[0] ? `${displayDate(period[0])} – ${displayDate(period[1])}` : '—'}</span></div>
              <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {gst.effectivePct > 0 ? (
                <>
                  <div className="flex justify-between"><span>CGST ({gst.halfPct}%)</span><span>{money(gst.cgst)}</span></div>
                  <div className="flex justify-between"><span>SGST ({gst.halfPct}%)</span><span>{money(gst.sgst)}</span></div>
                </>
              ) : (
                <div className="flex justify-between text-ink-500"><span>GST</span><span>{gstTreatment === 'full_waiver' ? 'Waived' : money(0)}</span></div>
              )}
              {gst.note && <div className="text-xs text-ink-400">{gst.note}</div>}
              <div className="flex justify-between"><span>Adjustments</span><span>{money(adjustments)}</span></div>
              <div className="flex justify-between font-semibold text-base border-t border-ink-200 pt-2"><span>Grand Total</span><span>{money(grandTotal)}</span></div>
              <button className="btn-primary w-full mt-3" disabled={saving} onClick={generate}>{saving ? 'Generating…' : 'Generate Bill'}</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
