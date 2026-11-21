import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useSuppliers } from '../lib/queries'
import { useToast } from './Toast'
import { Field, Input, Select } from './ui'
import { money } from '../lib/format'

// Pay a vendor without a FORMGRID bill. The payment is taken off the vendor's outstanding approved bills,
// oldest first. Cash counts as paid at once; RTGS / NEFT stays pending until the bank statement matches it.
export default function RecordPaymentModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const suppliersQ = useSuppliers()
  const [form, setForm] = useState({ supplier_id: '', mode: 'rtgs_neft', amount: '', utr: '', remarks: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const balanceQ = useQuery({
    queryKey: ['vendor_open_balance', form.supplier_id],
    enabled: !!form.supplier_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('vendor_open_balance', { p_supplier_id: form.supplier_id })
      if (error) throw error
      return Number(data || 0)
    },
  })
  const owed = balanceQ.data
  // What is owed before return credits are taken off: only a payment above this is warned about.
  const grossQ = useQuery({
    queryKey: ['vendor_gross_open', form.supplier_id],
    enabled: !!form.supplier_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('vendor_gross_open', { p_supplier_id: form.supplier_id })
      if (error) throw error
      return Number(data || 0)
    },
  })
  const gross = grossQ.data
  const amountNum = Number(form.amount) || 0
  const overGross = gross != null && amountNum > gross + 0.5
  const overOpen = owed != null && amountNum > owed + 0.5

  async function submit(e) {
    e.preventDefault()
    if (overGross && !window.confirm(`This is ${money(amountNum - gross)} more than the ${money(gross)} owed on their bills (before return credits). The extra is kept as an advance for their next bill. Record it anyway?`)) return
    setSaving(true)
    const { error } = await supabase.rpc('record_vendor_payment', {
      p_supplier_id: form.supplier_id, p_mode: form.mode, p_amount: Number(form.amount),
      p_utr: form.utr || null, p_remarks: form.remarks || null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(form.mode === 'cash' ? 'Cash payment recorded.' : 'Payment recorded. It counts as paid once the bank statement matches it.')
    for (const key of ['pending_payables', 'rtgs_payments', 'vendor_open_balance', 'vendor_gross_open', 'vendor_advance']) qc.invalidateQueries({ queryKey: [key] })
    qc.invalidateQueries({ queryKey: ['vendor_dashboard'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="card p-5 w-full max-w-md space-y-3">
        <div className="text-sm font-semibold text-ink-950">Record a payment to a vendor</div>
        <p className="text-xs text-ink-500">No FORMGRID bill needed. The amount is taken off the vendor's outstanding bills, oldest first; anything extra is kept as an advance.</p>
        <Field label="Vendor">
          <Select required value={form.supplier_id} onChange={set('supplier_id')}>
            <option value="">Select…</option>
            {(suppliersQ.data || []).filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {form.supplier_id && (
          <div className="text-xs text-ink-600">
            {balanceQ.isLoading ? 'Checking what is owed…' : <>Outstanding on their bills: <span className="tnum font-medium text-ink-950">{money(owed || 0)}</span></>}
          </div>
        )}
        {overGross && <div className="rounded border border-ink-200 bg-pill-warn-bg px-3 py-2 text-xs text-pill-warn-ink">More than the <b className="tnum">{money(gross)}</b> owed on their bills (before return credits). You will be asked to confirm; the extra {money(amountNum - gross)} is kept as an advance.</div>}
        {!overGross && overOpen && <div className="text-xs text-ink-600">Above what is open after return credits; the extra {money(amountNum - owed)} is kept as an advance for their next bill.</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid by">
            <Select value={form.mode} onChange={set('mode')}>
              <option value="rtgs_neft">RTGS / NEFT</option>
              <option value="cash">Cash</option>
            </Select>
          </Field>
          <Field label="Amount">
            <Input required type="number" min="0.01" step="any" value={form.amount} onChange={set('amount')} />
          </Field>
        </div>
        {form.mode === 'rtgs_neft' && (
          <Field label="UTR / reference (optional)"><Input value={form.utr} onChange={set('utr')} /></Field>
        )}
        <Field label="Remarks (optional)"><Input value={form.remarks} onChange={set('remarks')} /></Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={saving || !form.supplier_id}>{saving ? 'Saving…' : 'Record payment'}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
