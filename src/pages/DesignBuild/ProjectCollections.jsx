import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import { loadCollections, downloadReceipt } from '../../lib/projectCollectionsData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

const MODES = [['cash', 'Cash'], ['cheque', 'Cheque'], ['rtgs_neft', 'RTGS / NEFT'], ['upi', 'UPI'], ['other', 'Other']]

// Receivables for one Design Build project: the client's quotation, the scope of work with its
// additions and reductions, and the payments collected, each with a FORMGRID receipt.
export default function ProjectCollections() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['project_collections', id], queryFn: () => loadCollections(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['project_collections', id] })

  if (q.isLoading) return <LoadingBlock />
  if (q.error) return <EmptyState title="Could not load receivables" hint={q.error.message} />
  const d = q.data
  const pct = d.contract ? Math.min(100, Math.round((d.received / d.contract) * 100)) : 0

  return (
    <div>
      <PageHeader
        title={`${d.project.name} · collections`}
        subtitle={`${d.project.code} · ${d.project.clients?.name || 'No client set'}`}
        actions={<Link className="btn-secondary" to={`/design-build/projects/${id}`}>Project page</Link>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card><StatCard label="Contract value" value={money(d.contract)} money /></Card>
        <Card><StatCard label="Received" value={money(d.received)} money /></Card>
        <Card><StatCard label="Balance due" value={money(d.balance)} money /></Card>
        <Card><StatCard label="Collected" value={`${pct}%`} /></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <QuotationCard projectId={id} quotations={d.quotations} onSaved={refresh} />
        <RecordPayment projectId={id} onSaved={refresh} toast={toast} />
      </div>

      <ScopeCard projectId={id} scope={d.scope} onSaved={refresh} toast={toast} />

      <Card title={`Receipts (${d.receipts.length})`} className="mt-5">
        {!d.receipts.length ? <EmptyState title="No payments recorded yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Mode</th><th>Reference</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {d.receipts.map((c) => (
                  <tr key={c.id} className={c.voided ? 'text-ink-400 line-through' : ''}>
                    <td className="font-mono text-xs">{c.receipt_no}</td>
                    <td>{displayDate(c.receipt_date)}</td>
                    <td>{c.received_from || '—'}</td>
                    <td className="capitalize">{c.mode.replace('_', '/')}</td>
                    <td>{c.reference || '—'}</td>
                    <td className="num">{money(c.amount)}</td>
                    <td className="text-right whitespace-nowrap no-underline">
                      {!c.voided && <button className="btn-ghost text-xs px-2" onClick={() => downloadReceipt({ project: d.project, collection: c, summary: { contract: d.contract, balance: d.balance } })}>Receipt PDF</button>}
                      {!c.voided && <VoidReceipt collection={c} onDone={refresh} toast={toast} />}
                      {c.voided && <span className="text-xs">Voided: {c.void_reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function QuotationCard({ projectId, quotations, onSaved }) {
  const toast = useToast()
  const [label, setLabel] = useState('Quotation')
  const [total, setTotal] = useState('')
  const [busy, setBusy] = useState(false)

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `design-quotations/${projectId}/${Date.now()}_${safe}`
    const { error: upErr } = await supabase.storage.from('scan-uploads').upload(path, file)
    if (upErr) { setBusy(false); return toast.error(upErr.message) }
    const { error } = await supabase.from('project_quotations').insert({
      design_project_id: projectId, label: label || 'Quotation', quoted_total: Number(total || 0), file_path: path, file_name: file.name,
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Quotation saved.')
    onSaved()
  }

  async function open(q) {
    if (!q.file_path) return
    const { data } = await supabase.storage.from('scan-uploads').createSignedUrl(q.file_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <Card title="Quotation">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="text-xs">Label<input className="field-input mt-1" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="text-xs">Quoted total (Rs.)<input type="number" min="0" step="0.01" className="field-input mt-1" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      </div>
      <label className="btn-primary cursor-pointer inline-block">
        {busy ? 'Uploading…' : 'Upload quotation'}
        <input type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={busy} onChange={upload} />
      </label>
      <div className="mt-4">
        {!quotations.length ? <EmptyState title="No quotation uploaded yet" /> : (
          <ul className="divide-y divide-ink-100">
            {quotations.map((x) => (
              <li key={x.id} className="py-2 flex items-center justify-between text-sm">
                <span>{x.label} · {displayDate(x.quoted_on)} · {money(x.quoted_total)}</span>
                {x.file_path && <button className="btn-ghost text-xs px-2" onClick={() => open(x)}>Open {x.file_name}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function ScopeCard({ projectId, scope, onSaved, toast }) {
  const [add, setAdd] = useState({ kind: 'original', description: '', unit_text: '', quantity: '1', rate: '' })
  const [red, setRed] = useState({ description: '', amount: '', note: '' })

  async function addItem(e) {
    e.preventDefault()
    const quantity = Number(add.quantity || 1)
    const rate = Number(add.rate || 0)
    const { error } = await supabase.from('project_scope_items').insert({
      design_project_id: projectId, kind: add.kind, description: add.description, unit_text: add.unit_text || null,
      quantity, rate, amount: Math.round(quantity * rate * 100) / 100,
    })
    if (error) return toast.error(error.message)
    setAdd({ kind: 'original', description: '', unit_text: '', quantity: '1', rate: '' })
    toast.success(add.kind === 'added' ? 'Scope added.' : 'Scope item added.')
    onSaved()
  }

  async function reduce(e) {
    e.preventDefault()
    const amount = Math.abs(Number(red.amount || 0))
    if (!amount) return toast.error('Enter the amount to reduce.')
    const { error } = await supabase.from('project_scope_items').insert({
      design_project_id: projectId, kind: 'reduced', description: red.description, quantity: 1, rate: 0, amount: -amount, note: red.note || null,
    })
    if (error) return toast.error(error.message)
    setRed({ description: '', amount: '', note: '' })
    toast.success('Scope reduced.')
    onSaved()
  }

  const total = scope.reduce((t, s) => t + Number(s.amount), 0)
  const KIND = { original: 'Original', added: 'Added', reduced: 'Reduced' }

  return (
    <Card title={`Scope of work (${scope.length} line${scope.length === 1 ? '' : 's'})`}>
      {!scope.length ? <EmptyState title="No scope of work yet" hint="Add the items from the quotation, then record additions and reductions as the scope changes." /> : (
        <div className="overflow-x-auto mb-4">
          <table className="table-base">
            <thead><tr><th>Type</th><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {scope.map((s) => (
                <tr key={s.id}>
                  <td>{KIND[s.kind]}</td>
                  <td>{s.description}{s.note ? <span className="text-xs text-ink-500"> · {s.note}</span> : ''}</td>
                  <td>{s.unit_text || '—'}</td>
                  <td className="num">{s.kind === 'reduced' ? '—' : qty(s.quantity)}</td>
                  <td className="num">{s.kind === 'reduced' ? '—' : money(s.rate)}</td>
                  <td className={`num ${Number(s.amount) < 0 ? 'text-bad' : ''}`}>{money(s.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5} className="font-medium">Contract value</td><td className="num font-medium">{money(total)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-5">
        <form onSubmit={addItem} className="space-y-2">
          <div className="text-xs font-medium text-ink-600">Add to scope</div>
          <div className="grid grid-cols-2 gap-2">
            <select className="field-input" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
              <option value="original">From the quotation</option>
              <option value="added">Added later</option>
            </select>
            <input className="field-input" required placeholder="Description" value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} />
            <input className="field-input" placeholder="Unit" value={add.unit_text} onChange={(e) => setAdd({ ...add, unit_text: e.target.value })} />
            <input className="field-input" type="number" min="0" step="0.0001" placeholder="Qty" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} />
            <input className="field-input" type="number" min="0" step="0.01" placeholder="Rate" value={add.rate} onChange={(e) => setAdd({ ...add, rate: e.target.value })} />
          </div>
          <button className="btn-secondary" type="submit">Add item</button>
        </form>
        <form onSubmit={reduce} className="space-y-2">
          <div className="text-xs font-medium text-ink-600">Reduce scope</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="field-input" required placeholder="What is removed" value={red.description} onChange={(e) => setRed({ ...red, description: e.target.value })} />
            <input className="field-input" type="number" min="0" step="0.01" required placeholder="Amount reduced" value={red.amount} onChange={(e) => setRed({ ...red, amount: e.target.value })} />
            <input className="field-input col-span-2" placeholder="Reason (optional)" value={red.note} onChange={(e) => setRed({ ...red, note: e.target.value })} />
          </div>
          <button className="btn-secondary" type="submit">Reduce scope</button>
        </form>
      </div>
    </Card>
  )
}

function RecordPayment({ projectId, onSaved, toast }) {
  const blank = { amount: '', date: new Date().toISOString().slice(0, 10), mode: 'rtgs_neft', reference: '', received_from: '', notes: '' }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase.rpc('record_project_collection', {
      p_design_project_id: projectId, p_amount: Number(form.amount), p_mode: form.mode, p_date: form.date,
      p_reference: form.reference, p_received_from: form.received_from, p_notes: form.notes,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`Payment recorded. Receipt ${data?.receipt_no || ''}`)
    setForm({ ...blank, mode: form.mode })
    onSaved()
  }

  return (
    <Card title="Record a payment">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2">
        <label className="text-xs">Amount received (Rs.)<input type="number" min="0.01" step="0.01" required className="field-input mt-1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label className="text-xs">Date<input type="date" required className="field-input mt-1" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label className="text-xs">Mode<select className="field-input mt-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-xs">Reference / UTR<input className="field-input mt-1" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
        <label className="text-xs col-span-2">Received from<input className="field-input mt-1" value={form.received_from} onChange={(e) => setForm({ ...form, received_from: e.target.value })} /></label>
        <label className="text-xs col-span-2">Notes<input className="field-input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="col-span-2"><button className="btn-primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Record payment and issue receipt'}</button></div>
      </form>
    </Card>
  )
}

function VoidReceipt({ collection, onDone, toast }) {
  async function voidIt() {
    const reason = window.prompt(`Void receipt ${collection.receipt_no}? Why?`)
    if (!reason) return
    const { error } = await supabase.rpc('void_project_collection', { p_collection_id: collection.id, p_reason: reason })
    if (error) return toast.error(error.message)
    toast.success('Receipt voided.')
    onDone()
  }
  return <button className="btn-ghost text-xs px-2" onClick={voidIt}>Void</button>
}
