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
  const [act, setAct] = useState(null) // the follow-up action being filled in: { type, slip, ...fields }

  const slipsQ = useQuery({
    queryKey: ['supplier_return_slips'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_return_slips')
        .select('id, slip_number, return_date, reason, total_amount, follow_up_status, slip_filed_reference, slip_filed_on, supplier_id, credit_status, credit_note_number, credit_note_date, credit_amount, credit_settled_how, credit_settled_on, credit_settled_reference, adjusted_bill_id, next_follow_up_on, supplier:suppliers(name), location:inventory_locations(name), supplier_return_slip_items(quantity, unit_cost, total_amount, reason, inventory_items(name, units(code)))')
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
  const allItems = itemsQ.data || []

  // Only what that supplier supplied and is still in stock at the chosen location can be returned.
  const returnableQ = useQuery({
    queryKey: ['returnable_items', form.supplier_id, form.location_id],
    enabled: !!form.supplier_id && !!form.location_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('returnable_items', { p_supplier_id: form.supplier_id, p_location_id: form.location_id })
      if (error) throw error
      return data || []
    },
  })
  const available = new Map((returnableQ.data || []).map((r) => [r.item_id, Number(r.quantity)]))
  const items = allItems.filter((it) => available.has(it.id))
  const pending = (slipsQ.data || []).filter((s) => s.follow_up_status === 'pending_slip' || s.credit_status !== 'settled')

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
                <Select required value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value, lines: form.lines.map((l) => ({ ...l, item_id: '' })) })}>
                  <option value="">Choose…</option>
                  {(suppliersQ.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Returned from">
                <Select required value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value, lines: form.lines.map((l) => ({ ...l, item_id: '' })) })}>
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
                      <Select value={l.item_id} disabled={!form.supplier_id || !form.location_id} onChange={(e) => setLine(i, { item_id: e.target.value })}>
                        <option value="">{!form.supplier_id || !form.location_id ? 'Choose the supplier and location first…' : returnableQ.isLoading ? 'Loading…' : items.length ? 'Choose…' : 'Nothing from this supplier is in stock here'}</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name} — {qty(available.get(it.id))} in stock</option>)}
                      </Select>
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label={i === 0 ? 'Quantity' : null}>
                      <Input type="number" min="0.0001" max={available.get(l.item_id) || undefined} step="0.0001" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
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

      <Card title={`Returns to follow up (${pending.length})`} className="mb-5">
        {slipsQ.isLoading ? <LoadingBlock /> : !pending.length ? <EmptyState title="Nothing to follow up" hint="Every return has its signed slip filed and its credit settled." /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Slip</th><th>Date</th><th>Supplier</th><th className="num">Credit</th><th>Signed slip</th><th>Vendor credit</th><th>Next follow-up</th><th /></tr></thead>
              <tbody>
                {pending.map((sl) => {
                  const overdue = sl.next_follow_up_on && sl.next_follow_up_on < today()
                  return (
                    <tr key={sl.id}>
                      <td className="font-medium">{sl.slip_number}<div className="text-xs text-ink-500 font-normal">{sl.location?.name}</div></td>
                      <td>{displayDate(sl.return_date)}</td>
                      <td>{sl.supplier?.name}</td>
                      <td className="num">{money(sl.credit_amount ?? sl.total_amount)}{sl.credit_amount != null && Number(sl.credit_amount) !== Number(sl.total_amount) && <div className="text-[11px] text-ink-500">stock {money(sl.total_amount)}</div>}</td>
                      <td>{sl.follow_up_status === 'filed' ? `Filed ${sl.slip_filed_reference || ''}` : <span className="text-warn">To file</span>}</td>
                      <td>
                        {sl.credit_status === 'awaiting_credit' && <span className="text-warn">Awaiting credit note</span>}
                        {sl.credit_status === 'credit_received' && <span>Credit note {sl.credit_note_number}<div className="text-[11px] text-ink-500">to settle</div></span>}
                        {sl.credit_status === 'settled' && 'Settled'}
                      </td>
                      <td>{sl.next_follow_up_on ? <span className={overdue ? 'text-bad font-medium' : ''}>{displayDate(sl.next_follow_up_on)}{overdue ? ' · overdue' : ''}</span> : '—'}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs px-2" onClick={() => downloadSlip(sl)}>Slip PDF</button>
                        {sl.follow_up_status === 'pending_slip' && <button className="btn-ghost text-xs px-2" onClick={() => setFiling({ slip: sl, reference: '', filedOn: today() })}>File slip</button>}
                        {sl.credit_status === 'awaiting_credit' && <button className="btn-ghost text-xs px-2" onClick={() => setAct({ type: 'note', slip: sl, number: '', date: today(), amount: String(sl.total_amount) })}>Credit note</button>}
                        {sl.credit_status === 'credit_received' && <button className="btn-ghost text-xs px-2" onClick={() => setAct({ type: 'settle', slip: sl, how: 'refunded', reference: '', date: today(), billId: '' })}>Settle credit</button>}
                        <button className="btn-ghost text-xs px-2" onClick={() => setAct({ type: 'log', slip: sl, note: '', next: '' })}>Follow up</button>
                      </td>
                    </tr>
                  )
                })}
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
        {act && <FollowUpForm act={act} setAct={setAct} onDone={() => { setAct(null); qc.invalidateQueries({ queryKey: ['supplier_return_slips'] }); qc.invalidateQueries({ queryKey: ['pending_payables'] }); qc.invalidateQueries({ queryKey: ['vendor_dashboard'] }) }} />}
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

// One follow-up step on a return: record the vendor's credit note, settle the credit, or log a chase.
function FollowUpForm({ act, setAct, onDone }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const slip = act.slip
  const billsQ = useQuery({
    queryKey: ['vendor_open_bills', slip.supplier_id],
    enabled: act.type === 'settle' && act.how === 'adjusted',
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bills').select('id, internal_bill_number, bill_date, grand_total').eq('supplier_id', slip.supplier_id).eq('status', 'approved').order('bill_date')
      if (error) throw error
      return data || []
    },
  })
  const set = (patch) => setAct({ ...act, ...patch })

  async function save() {
    setBusy(true)
    let res
    if (act.type === 'note') {
      res = await supabase.rpc('record_return_credit_note', { p_slip_id: slip.id, p_number: act.number, p_date: act.date, p_amount: Number(act.amount) })
    } else if (act.type === 'settle') {
      res = await supabase.rpc('settle_return_credit', { p_slip_id: slip.id, p_how: act.how, p_reference: act.reference || null, p_on: act.date, p_bill_id: act.how === 'adjusted' ? act.billId || null : null })
    } else {
      res = await supabase.rpc('log_return_followup', { p_slip_id: slip.id, p_note: act.note, p_next: act.next || null })
    }
    setBusy(false)
    if (res.error) return toast.error(res.error.message)
    toast.success(act.type === 'note' ? 'Credit note recorded.' : act.type === 'settle' ? 'Credit settled.' : 'Follow-up logged.')
    onDone()
  }

  return (
    <div className="mt-4 rounded-md border border-brand-500 bg-brand-100 p-4">
      <div className="text-sm font-medium text-ink-950 mb-3">
        {act.type === 'note' ? `Vendor credit note for ${slip.slip_number}` : act.type === 'settle' ? `Settle the credit for ${slip.slip_number}` : `Follow up ${slip.slip_number}`}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {act.type === 'note' && (
          <>
            <Field label="Credit note number"><Input value={act.number} onChange={(e) => set({ number: e.target.value })} /></Field>
            <Field label="Credit note date"><Input type="date" value={act.date} onChange={(e) => set({ date: e.target.value })} /></Field>
            <Field label={`Credit amount (stock was ${money(slip.total_amount)})`}><Input type="number" step="0.01" value={act.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
          </>
        )}
        {act.type === 'settle' && (
          <>
            <Field label="How was it settled">
              <Select value={act.how} onChange={(e) => set({ how: e.target.value })}>
                <option value="refunded">Vendor refunded the money</option>
                <option value="adjusted">Adjusted against a bill</option>
              </Select>
            </Field>
            {act.how === 'adjusted' ? (
              <Field label="Against bill">
                <Select value={act.billId} onChange={(e) => set({ billId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(billsQ.data || []).map((b) => <option key={b.id} value={b.id}>{b.internal_bill_number} · {displayDate(b.bill_date)} · {money(b.grand_total)}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Refund reference (UTR / receipt)"><Input value={act.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
            )}
            <Field label="Settled on"><Input type="date" value={act.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          </>
        )}
        {act.type === 'log' && (
          <>
            <div className="md:col-span-2"><Field label="What was followed up"><Input value={act.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Called the vendor, credit note promised by Friday" /></Field></div>
            <Field label="Chase again on"><Input type="date" value={act.next} onChange={(e) => set({ next: e.target.value })} /></Field>
          </>
        )}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn-secondary" onClick={() => setAct(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
