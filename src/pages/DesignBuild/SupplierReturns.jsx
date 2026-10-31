import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, EmptyState, LoadingBlock, Field, Input, Select } from '../../components/ui'
import { useInventoryItems, useInventoryLocations } from '../../lib/queries'
import { listSuppliers } from '../../lib/statementData'
import { buildTableDoc, saveDoc } from '../../lib/reportPdf'
import { displayDate, today } from '../../lib/dates'
import { money, qty } from '../../lib/format'

// Returns to a supplier are processed straight away: the stock leaves at its average cost and the slip total
// is owed back by the supplier. The signed slip is then filed here, and until it is filed the slip stays on the
// follow-up list, the same way GST follow-ups work. Approved bills can also be voided from this page.
export default function SupplierReturns() {
  const [params] = useSearchParams()
  const toast = useToast()
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const suppliersQ = useQuery({ queryKey: ['suppliers_list'], queryFn: listSuppliers })
  const itemsQ = useInventoryItems()
  const locationsQ = useInventoryLocations()

  const [form, setForm] = useState(() => ({
    supplier_id: '',
    location_id: params.get('location') || '',
    return_date: today(),
    reason: '',
    lines: params.get('item')
      ? [{ item_id: params.get('item'), quantity: params.get('qty') || '', reason: '' }]
      : [{ item_id: '', quantity: '', reason: '' }],
  }))
  const [saving, setSaving] = useState(false)
  const [billNumber, setBillNumber] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [filing, setFiling] = useState(null)

  const slipsQ = useQuery({
    queryKey: ['supplier_return_slips'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_return_slips')
        .select('id, slip_number, return_date, reason, total_amount, follow_up_status, slip_filed_reference, slip_filed_on, supplier:suppliers(name), location:inventory_locations(name), supplier_return_slip_items(quantity, unit_cost, total_amount, reason, inventory_items(name, units(code)))')
        .order('return_date', { ascending: false })
        .limit(200)
      if (error) throw error
      return data || []
    },
  })

  const billQ = useQuery({
    queryKey: ['void_bill_lookup', billNumber],
    enabled: billNumber.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bills')
        .select('id, internal_bill_number, bill_date, grand_total, status, supplier_text, design_projects(name)')
        .eq('internal_bill_number', billNumber.trim())
        .limit(2)
      if (error) throw error
      return data || []
    },
  })

  const locations = locationsQ.data || []
  const items = itemsQ.data || []
  const pending = (slipsQ.data || []).filter((s) => s.follow_up_status === 'pending_slip')

  function setLine(i, patch) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }))
  }

  async function processReturn(e) {
    e.preventDefault()
    const lines = form.lines.filter((l) => l.item_id || l.quantity)
    if (!form.supplier_id) return toast.error('Choose the supplier the stock goes back to.')
    if (!form.location_id) return toast.error('Choose where the stock is returned from.')
    if (lines.length === 0 || lines.some((l) => !l.item_id || !(Number(l.quantity) > 0))) {
      return toast.error('Every line needs an item and a quantity above zero.')
    }
    setSaving(true)
    const { data: slipId, error } = await supabase.rpc('create_supplier_return', {
      p_supplier_id: form.supplier_id,
      p_location_id: form.location_id,
      p_return_date: form.return_date,
      p_reason: form.reason || null,
      p_items: lines.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity), reason: l.reason || null })),
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Return processed. The slip is now waiting to be filed.')
    setForm((f) => ({ ...f, reason: '', lines: [{ item_id: '', quantity: '', reason: '' }] }))
    qc.invalidateQueries({ queryKey: ['supplier_return_slips'] })
    qc.invalidateQueries({ queryKey: ['inventory_stock'] })
    return slipId
  }

  async function fileSlip(slip, reference, filedOn) {
    const { error } = await supabase.rpc('file_return_slip', {
      p_slip_id: slip.id, p_reference: reference, p_filed_on: filedOn,
    })
    if (error) return toast.error(error.message)
    toast.success(`Slip ${slip.slip_number} filed.`)
    setFiling(null)
    qc.invalidateQueries({ queryKey: ['supplier_return_slips'] })
  }

  function downloadSlip(slip) {
    const lines = slip.supplier_return_slip_items || []
    const doc = buildTableDoc({
      title: 'Return slip',
      subtitle: slip.slip_number,
      meta: [
        ['Supplier', slip.supplier?.name || '—'],
        ['Date', displayDate(slip.return_date)],
        ['From', slip.location?.name || '—'],
      ],
      cards: [['Total returned', money(slip.total_amount)]],
      sections: [{
        heading: 'Items returned',
        head: ['Item', 'Quantity', 'Rate', 'Amount'],
        body: lines.map((l) => [
          l.inventory_items?.name || '—',
          `${qty(l.quantity)} ${l.inventory_items?.units?.code || ''}`.trim(),
          money(l.unit_cost),
          money(l.total_amount),
        ]),
        foot: ['Total', '', '', money(slip.total_amount)],
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      }],
    })
    saveDoc(doc, `return-slip-${slip.slip_number}`)
  }

  async function lookupBill() {
    await billQ.refetch()
  }

  async function voidBill(bill) {
    if (!voidReason.trim()) return toast.error('Say why the bill is being voided.')
    const { error } = await supabase.rpc('void_supplier_bill', { p_bill_id: bill.id, p_reason: voidReason.trim() })
    if (error) return toast.error(error.message)
    toast.success(`Bill ${bill.internal_bill_number} voided and its stock reversed.`)
    setVoidReason('')
    setBillNumber('')
    qc.invalidateQueries({ queryKey: ['void_bill_lookup'] })
    qc.invalidateQueries({ queryKey: ['inventory_stock'] })
  }

  return (
    <div>
      <PageHeader
        title="Supplier returns & voids"
        subtitle="Send stock back to a supplier, file the signed return slip, or void an approved bill."
      />

      <Card title="Return stock to a supplier" className="mb-5">
        {!hasPermission('inventory_operate') ? <EmptyState title="You do not have permission to return stock." /> : (
          <form onSubmit={processReturn} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Field label="Supplier">
                <Select required value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {(suppliersQ.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Returned from">
                <Select required value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
              <Field label="Return date">
                <Input type="date" required value={form.return_date} onChange={(e) => setForm({ ...form, return_date: e.target.value })} />
              </Field>
              <Field label="Reason (optional)">
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </Field>
            </div>

            <div className="space-y-2">
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-5">
                    <Field label={i === 0 ? 'Item' : null}>
                      <Select value={l.item_id} onChange={(e) => setLine(i, { item_id: e.target.value })}>
                        <option value="">Choose…</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label={i === 0 ? 'Quantity' : null}>
                      <Input type="number" min="0.0001" step="0.0001" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    </Field>
                  </div>
                  <div className="md:col-span-4">
                    <Field label={i === 0 ? 'Line reason (optional)' : null}>
                      <Input value={l.reason} onChange={(e) => setLine(i, { reason: e.target.value })} />
                    </Field>
                  </div>
                  <div className="md:col-span-1">
                    <button type="button" className="btn-ghost text-xs" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))} disabled={form.lines.length === 1}>Remove</button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { item_id: '', quantity: '', reason: '' }] }))}>+ Add item</button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-500">The return is processed as soon as you press it. The signed slip is filed afterwards from the list below.</p>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Processing…' : 'Process return'}</button>
            </div>
          </form>
        )}
      </Card>

      <Card title={`Return slips to file (${pending.length})`} className="mb-5">
        {slipsQ.isLoading ? <LoadingBlock /> : !pending.length ? <EmptyState title="No slips waiting to be filed" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Slip</th><th>Date</th><th>Supplier</th><th>From</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.slip_number}</td>
                    <td>{displayDate(s.return_date)}</td>
                    <td>{s.supplier?.name}</td>
                    <td>{s.location?.name}</td>
                    <td className="num">{money(s.total_amount)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs px-2" onClick={() => downloadSlip(s)}>Download slip</button>
                      <button className="btn-ghost text-xs px-2" onClick={() => setFiling({ slip: s, reference: '', filedOn: today() })}>File signed slip</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filing && (
          <div className="mt-4 rounded-md border border-ink-200 p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <Field label={`Filing ${filing.slip.slip_number}: reference`}>
              <Input value={filing.reference} onChange={(e) => setFiling({ ...filing, reference: e.target.value })} />
            </Field>
            <Field label="Filed on">
              <Input type="date" value={filing.filedOn} onChange={(e) => setFiling({ ...filing, filedOn: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => fileSlip(filing.slip, filing.reference, filing.filedOn)}>Mark filed</button>
              <button className="btn-secondary" onClick={() => setFiling(null)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Void an approved bill" className="mb-5">
        {!hasPermission('supplier_bills_manage') ? <EmptyState title="You do not have permission to void bills." /> : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Field label="Bill number">
                <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="e.g. FG-2587" />
              </Field>
              <div><button className="btn-secondary" onClick={lookupBill}>Find bill</button></div>
            </div>
            {billNumber.trim() && billQ.data && billQ.data.length === 0 && <p className="text-sm text-ink-500">No bill with that number.</p>}
            {(billQ.data || []).filter((b) => b.status === 'approved').map((b) => (
              <div key={b.id} className="rounded-md border border-ink-200 p-4 space-y-3">
                <p className="text-sm text-ink-800">
                  <span className="font-medium">{b.internal_bill_number}</span> · {b.supplier_text} · {displayDate(b.bill_date)} · {money(b.grand_total)}
                  {b.design_projects?.name ? ` · ${b.design_projects.name}` : ''}
                </p>
                <p className="text-xs text-ink-500">Voiding puts back the stock this bill brought in. A bill with payments recorded must have them reversed first.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <Field label="Reason for voiding">
                    <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  </Field>
                  <div><button className="btn-danger" onClick={() => voidBill(b)}>Void bill</button></div>
                </div>
              </div>
            ))}
            {(billQ.data || []).some((b) => b.status !== 'approved') && (
              <p className="text-sm text-ink-500">Only an approved bill can be voided here. Unapproved bills are deleted from the Bill Audit Queue.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
