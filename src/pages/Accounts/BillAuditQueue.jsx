import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, ConfidencePill, EmptyState, LoadingBlock, Field, Input, Select } from '../../components/ui'
import { useSuppliers, useDesignProjects, invalidateInventory } from '../../lib/queries'
import { money } from '../../lib/format'

const COST_HEADS = [
  ['factory_labour', 'Factory Labour'], ['factory_consumables', 'Factory Consumables'],
  ['site_labour', 'Site Labour'], ['raw_boards', 'Raw Boards'],
  ['laminate_veneer', 'Laminate and Veneer'], ['fevicol_adhesives', 'Fevicol / Adhesives'],
  ['employee_salary', 'Employee Salary'], ['other', 'Other'],
]

const ANNEX_KINDS = [['vendor_bill', 'Vendor bill'], ['gst_invoice', 'GST invoice'], ['other', 'Other']]

// Stores an uploaded file in the scan bucket and returns its path.
async function storeBillFile(userId, file) {
  const path = `supplier-bills/${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error } = await supabase.storage.from('scan-uploads').upload(path, file)
  if (error) throw error
  return path
}

// Asks the classifier what a stored file is: formgrid_slip, vendor_bill, gst_invoice or other.
async function classifyBillFile(path, mime) {
  const { data, error } = await supabase.functions.invoke('classify-bill-file', { body: { path, mime } })
  if (error) throw new Error(data?.error || error.message)
  if (data?.error) throw new Error(data.error)
  return data.classification
}

export default function BillAuditQueue() {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [selectedId, setSelectedId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const queueQ = useQuery({
    queryKey: ['supplier_bills_queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bills').select('*, suppliers(name)')
        .in('status', ['pending_review'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
    refetchOnWindowFocus: false,
  })

  const rows = queueQ.data || []
  useEffect(() => {
    if (!selectedId && queueQ.data?.length) setSelectedId(queueQ.data[0].id)
  }, [queueQ.data, selectedId])

  // One uploaded file = one bill, whether it's a PNG/JPG photo or a PDF (a multi-page PDF is
  // read in full by the extraction function below -- a scanned slip with a back page, or a
  // front+back pair, is still one bill). Selecting several files at once queues each as its
  // own bill and extracts them one at a time; one bad file doesn't stop the rest.
  async function createSlipBill(path) {
    const { data: bill, error: billErr } = await supabase.from('supplier_bills').insert({
      internal_bill_number: `PENDING-${Date.now().toString().slice(-6)}`,
      bill_date: new Date().toISOString().slice(0, 10),
      expense_nature: 'material', scan_image_path: path, created_by: profile.id,
    }).select().single()
    if (billErr) throw billErr
    const { data: fnResult, error: fnErr } = await supabase.functions.invoke('extract-supplier-bill-scan', { body: { bill_id: bill.id } })
    if (fnErr) throw new Error(fnResult?.error || fnErr.message)
    if (fnResult?.error) throw new Error(fnResult.error)
    return bill
  }

  // Each file is classified on its own, so one upload can mix kinds. A FORMGRID slip becomes a
  // bill and is scanned. A vendor bill, GST invoice or other document is attached as an annexure
  // to the first slip in this upload, or to the bill open in the panel. If classification is
  // unavailable, the file is scanned as a slip, as it was before this step existed.
  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    const slipBills = []
    const annexures = []
    let failed = 0
    for (const file of files) {
      try {
        const path = await storeBillFile(profile.id, file)
        let kind = 'formgrid_slip'
        try {
          kind = (await classifyBillFile(path, file.type)).kind
        } catch { /* unavailable: scan it as a slip */ }
        if (kind === 'formgrid_slip') slipBills.push(await createSlipBill(path))
        else annexures.push({ path, file, kind })
      } catch (err) {
        failed += 1
        toast.error(`${file.name}: ${err.message || err}`)
      }
    }
    const targetId = slipBills[0]?.id ?? selectedId
    if (annexures.length) {
      if (!targetId) {
        toast.error('Scan a FORMGRID slip first, then attach these documents to it.')
      } else {
        const { error } = await supabase.from('supplier_bill_annexures').insert(annexures.map((x) => ({
          bill_id: targetId,
          kind: x.kind === 'vendor_bill' || x.kind === 'gst_invoice' ? x.kind : 'other',
          file_path: x.path,
          file_name: x.file.name,
          mime_type: x.file.type,
          size_bytes: x.file.size,
        })))
        if (error) toast.error(error.message)
        else {
          qc.invalidateQueries({ queryKey: ['supplier_bill_annexures', targetId] })
          toast.success(`${annexures.length} document${annexures.length === 1 ? '' : 's'} attached as annexures`)
        }
      }
    }
    setUploading(false)
    qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] })
    if (slipBills.length) toast.success(slipBills.length === 1 ? 'Bill scanned — review below.' : `${slipBills.length} bills scanned — review below.`)
    if (slipBills[0]) setSelectedId(slipBills[0].id)
  }

  function goNext(fromId) {
    const idx = rows.findIndex((r) => r.id === fromId)
    const next = rows[idx + 1] || rows.find((r) => r.id !== fromId)
    setSelectedId(next ? next.id : null)
  }

  return (
    <div>
      <PageHeader
        title="Bill Audit Queue"
        subtitle={`${rows.length} bill${rows.length === 1 ? '' : 's'} pending review`}
        actions={
          <label className="btn-primary cursor-pointer">
            {uploading ? 'Uploading…' : '+ Scan bill'}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={handleUpload}
            />
          </label>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <Card className="p-0 overflow-hidden lg:h-[calc(100vh-180px)] lg:overflow-y-auto">
          {queueQ.isLoading ? <LoadingBlock /> : !rows.length ? (
            <div className="p-4"><EmptyState title="Queue is empty" hint="Scan a bill to get started." /></div>
          ) : (
            <ul>
              {rows.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-ink-100 ${selectedId === b.id ? 'bg-ink-100' : 'hover:bg-ink-50'}`}
                  >
                    <div className="text-sm font-medium text-ink-950 truncate">{b.suppliers?.name || b.supplier_text || 'Unidentified supplier'}</div>
                    <div className="text-xs text-ink-500 flex items-center justify-between mt-0.5">
                      <span className="tnum">{money(b.grand_total)}</span>
                      <Badge tone="warn">Reviewing</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selectedId ? (
          <AuditPanel key={selectedId} billId={selectedId} onDone={() => { qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] }); goNext(selectedId) }} />
        ) : (
          <Card><EmptyState title="Nothing selected" hint="Scan a bill or pick one from the queue." /></Card>
        )}
      </div>
    </div>
  )
}

// Shown when the scan read a supplier name that is not in the suppliers master. Asks before adding,
// reuses a supplier that already has the same name, and links the bill to it.
function NewSupplierPrompt({ bill }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const d = bill.supplier_details || {}
  const name = (d.name || bill.supplier_text || '').trim()
  if (dismissed || !name) return null

  async function add() {
    setBusy(true)
    const { data: existing, error: findErr } = await supabase.from('suppliers').select('id')
      .ilike('name', name.replace(/[%_\\]/g, '\\$&')).limit(1)
    if (findErr) { setBusy(false); return toast.error(findErr.message) }
    let supplierId = existing?.[0]?.id
    if (!supplierId) {
      const { data, error } = await supabase.from('suppliers').insert({
        name, gstin: d.gstin || null, phone: d.phone || null, address: d.address || null,
      }).select('id').single()
      if (error) { setBusy(false); return toast.error(error.message) }
      supplierId = data.id
    }
    const { error } = await supabase.from('supplier_bills').update({ supplier_id: supplierId }).eq('id', bill.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
    qc.invalidateQueries({ queryKey: ['supplier_bill', bill.id] })
    qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] })
    toast.success(`${name} added to suppliers`)
  }

  return (
    <div className="rounded-md border border-brand-500 bg-brand-100 p-3 text-sm">
      <div className="font-medium text-ink-950">New supplier on this bill: {name}</div>
      <div className="mt-1 text-xs text-ink-600 space-y-0.5">
        {d.gstin && <div>GSTIN: <span className="tnum">{d.gstin}</span></div>}
        {d.phone && <div>Phone: <span className="tnum">{d.phone}</span></div>}
        {d.address && <div>Address: {d.address}</div>}
        {!d.gstin && !d.phone && !d.address && <div>No GSTIN, phone or address was read from the slip.</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add to suppliers'}</button>
        <button className="btn-secondary" onClick={() => setDismissed(true)} disabled={busy}>Not now</button>
      </div>
    </div>
  )
}

function AuditPanel({ billId, onDone }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const suppliersQ = useSuppliers()
  const projectsQ = useDesignProjects()
  const [saving, setSaving] = useState(false)

  const billQ = useQuery({
    queryKey: ['supplier_bill', billId],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bills').select('*').eq('id', billId).single()
      if (error) throw error
      return data
    },
  })
  const itemsLineQ = useQuery({
    queryKey: ['supplier_bill_items', billId],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bill_items').select('*').eq('bill_id', billId).order('sort_order')
      if (error) throw error
      return data
    },
  })
  const paymentsQ = useQuery({
    queryKey: ['supplier_bill_payments', billId],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bill_payments').select('*').eq('bill_id', billId)
      if (error) throw error
      return data
    },
  })
  const suggestionsQ = useQuery({
    queryKey: ['material_match_suggestions', billId],
    queryFn: async () => {
      const { data, error } = await supabase.from('material_match_suggestions').select('*, inventory_items:suggested_inventory_item_id(name)')
        .in('supplier_bill_item_id', (itemsLineQ.data || []).map((i) => i.id)).eq('status', 'pending')
      if (error) throw error
      return data
    },
    enabled: !!itemsLineQ.data?.length,
  })

  const annexuresQ = useQuery({
    queryKey: ['supplier_bill_annexures', billId],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bill_annexures').select('*').eq('bill_id', billId).order('created_at')
      if (error) throw error
      return data
    },
  })

  // Adds documents to this bill. A FORMGRID slip is refused here, since it belongs in Scan bill.
  async function addAnnexures(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setSaving(true)
    for (const file of files) {
      try {
        const path = await storeBillFile(profile.id, file)
        let kind = 'other'
        try { kind = (await classifyBillFile(path, file.type)).kind } catch { /* keep as other */ }
        if (kind === 'formgrid_slip') {
          toast.error(`${file.name} looks like a FORMGRID slip. Use Scan bill to add it as a bill.`)
          continue
        }
        const { error } = await supabase.from('supplier_bill_annexures').insert({
          bill_id: billId,
          kind: kind === 'vendor_bill' || kind === 'gst_invoice' ? kind : 'other',
          file_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        })
        if (error) toast.error(error.message)
      } catch (err) {
        toast.error(`${file.name}: ${err.message || err}`)
      }
    }
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['supplier_bill_annexures', billId] })
  }

  async function setAnnexureKind(id, kind) {
    const { error } = await supabase.from('supplier_bill_annexures').update({ kind }).eq('id', id)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['supplier_bill_annexures', billId] })
  }

  async function removeAnnexure(id) {
    const { error } = await supabase.from('supplier_bill_annexures').delete().eq('id', id)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['supplier_bill_annexures', billId] })
  }

  async function openAnnexure(a) {
    const { data } = await supabase.storage.from('scan-uploads').createSignedUrl(a.file_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    else toast.error('Could not open that document.')
  }

  const imageUrl = useQuery({
    queryKey: ['scan_url', billQ.data?.scan_image_path],
    enabled: !!billQ.data?.scan_image_path,
    queryFn: async () => {
      const { data } = await supabase.storage.from('scan-uploads').createSignedUrl(billQ.data.scan_image_path, 3600)
      return data?.signedUrl
    },
  }).data

  const totalAllocated = (paymentsQ.data || []).reduce((s, p) => s + Number(p.allocated_amount), 0)
  const grandTotal = Number(billQ.data?.grand_total || 0)
  const reconciled = Math.abs(totalAllocated - grandTotal) < 0.01

  async function patchBill(patch) {
    const { error } = await supabase.from('supplier_bills').update(patch).eq('id', billId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['supplier_bill', billId] })
  }

  const approve = useCallback(async () => {
    setSaving(true)
    const { error } = await supabase.rpc('approve_supplier_bill', { p_bill_id: billId })
    setSaving(false)
    if (error) return toast.error(error.message)
    // Approval posts a stock purchase into the bill's project (or company pool) when its
    // lines are matched to tracked inventory items -- without this, Company Inventory, the
    // project's own dashboard, and the projects list summary all kept showing pre-approval
    // numbers until something else happened to invalidate their queries.
    invalidateInventory(qc)
    toast.success('Bill approved.')
    onDone()
  }, [billId, toast, onDone, qc])

  const flag = useCallback(async () => {
    const note = window.prompt('Flag this bill — what needs attention?')
    if (note == null) return
    await supabase.from('supplier_bills').update({ remarks: [billQ.data?.remarks, `[Flagged] ${note}`].filter(Boolean).join(' · ') }).eq('id', billId)
    toast.info('Flagged — left in the queue.')
    onDone()
  }, [billId, billQ.data, toast, onDone])

  async function deleteBill() {
    if (!window.confirm('Permanently delete this bill and its line items and payments? This cannot be undone.')) return
    const { error } = await supabase.rpc('delete_supplier_bill', { p_bill_id: billId })
    if (error) return toast.error(error.message)
    toast.success('Bill deleted.')
    qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] })
    onDone()
  }

  const handleKey = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return
    if (e.key === 'Enter') { e.preventDefault(); approve() }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flag() }
  }, [approve, flag])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (billQ.isLoading) return <Card><LoadingBlock /></Card>
  const b = billQ.data
  const conf = b.field_confidence || {}

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
      <Card className="p-0 overflow-hidden bg-ink-100 flex items-center justify-center min-h-[320px] lg:h-[calc(100vh-180px)]">
        {!imageUrl ? <div className="text-ink-400 text-sm">No scan attached</div>
          : /\.pdf($|\?)/i.test(b.scan_image_path)
            ? <iframe src={imageUrl} title="Scanned bill" className="w-full h-full min-h-[320px] lg:min-h-0" />
            : <img src={imageUrl} alt="Scanned bill" className="max-h-full max-w-full object-contain" />}
      </Card>

      <div className="space-y-4 lg:h-[calc(100vh-180px)] lg:overflow-y-auto lg:pr-1">
        <Card title="Annexures">
          {(annexuresQ.data || []).length === 0 && (
            <p className="text-sm text-ink-500">No vendor bill, GST invoice or other document attached yet.</p>
          )}
          <ul className="divide-y divide-ink-100">
            {(annexuresQ.data || []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <button type="button" onClick={() => openAnnexure(a)} className="min-w-0 flex-1 truncate text-left text-sm text-brand-700 hover:underline">
                  {a.file_name}
                </button>
                <Select value={a.kind} onChange={(e) => setAnnexureKind(a.id, e.target.value)} className="w-auto py-1 text-xs">
                  {ANNEX_KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </Select>
                <button type="button" onClick={() => removeAnnexure(a.id)} className="btn-ghost h-7 px-2 text-xs">Remove</button>
              </li>
            ))}
          </ul>
          <label className="btn-secondary mt-3 inline-flex cursor-pointer">
            {saving ? 'Attaching…' : 'Attach document'}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" disabled={saving} onChange={addAnnexures} />
          </label>
        </Card>

        <Card title="Basic details">
          <div className="space-y-3">
            {billQ.data && !billQ.data.supplier_id && <NewSupplierPrompt bill={billQ.data} />}
            <div className="flex items-center justify-between gap-2">
              <Field label="Supplier">
                <Select value={b.supplier_id || ''} onChange={(e) => patchBill({ supplier_id: e.target.value || null })}>
                  <option value="">{b.supplier_text ? `"${b.supplier_text}" — unmatched` : 'Select…'}</option>
                  {(suppliersQ.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <ConfidencePill value={conf.supplier_name} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill number"><Input value={b.internal_bill_number} onChange={(e) => patchBill({ internal_bill_number: e.target.value })} /></Field>
              <Field label="Bill date"><Input type="date" value={b.bill_date} onChange={(e) => patchBill({ bill_date: e.target.value })} /></Field>
            </div>
            <Field label="Design Build project (optional — blank = Factory's own expense)">
              <Select value={b.design_project_id || ''} onChange={(e) => patchBill({ design_project_id: e.target.value || null })}>
                <option value="">— Factory expense —</option>
                {(projectsQ.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Expense nature">
              <Select value={b.expense_nature} onChange={(e) => patchBill({ expense_nature: e.target.value })}>
                <option value="material">Material</option><option value="labour">Labour</option><option value="both">Both</option>
              </Select>
            </Field>
            <div>
              <div className="field-label mb-1">Cost head</div>
              <div className="flex flex-wrap gap-1.5">
                {COST_HEADS.map(([key, label]) => {
                  const active = (b.cost_heads || []).includes(key)
                  return (
                    <button
                      key={key} type="button"
                      onClick={() => patchBill({ cost_heads: active ? b.cost_heads.filter((h) => h !== key) : [...(b.cost_heads || []), key] })}
                      className={`text-xs px-2 py-1 rounded-full border ${active ? 'bg-ink-900 text-white border-ink-900' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card title={`Line items (${itemsLineQ.data?.length || 0})`}>
          {!itemsLineQ.data?.length ? <EmptyState title="No line items extracted" /> : (
            <div className="space-y-2">
              {itemsLineQ.data.map((li) => (
                <LineItemRow key={li.id} item={li} suggestions={(suggestionsQ.data || []).filter((s) => s.supplier_bill_item_id === li.id)} billId={billId} />
              ))}
            </div>
          )}
          <div className="flex justify-between mt-3 pt-3 border-t border-ink-100 text-sm">
            <span className="text-ink-500">GST {money(b.tax_amount)} on {money(b.subtotal)}</span>
            <span className="font-semibold tnum">{money(b.grand_total)}</span>
          </div>
        </Card>

        <Card title="Payment allocation">
          <PaymentAllocation billId={billId} payments={paymentsQ.data || []} grandTotal={grandTotal} />
          <div className="flex justify-between mt-3 pt-3 border-t border-ink-100 text-xs">
            <span className="text-ink-500">Allocated {money(totalAllocated)} of {money(grandTotal)}</span>
            <Badge tone={reconciled ? 'ok' : 'warn'}>{reconciled ? 'Amounts match' : 'Does not reconcile'}</Badge>
          </div>
        </Card>

        <div className="flex items-center gap-2 pt-1">
          <button className="btn-secondary" onClick={flag}>Flag issue <kbd className="ml-1 text-[10px] opacity-60">F</kbd></button>
          <button className="btn-secondary text-bad" onClick={deleteBill}>Delete bill</button>
          <button className="btn-primary flex-1" disabled={saving} onClick={approve}>
            {saving ? 'Approving…' : 'Approve & next'} <kbd className="ml-1 text-[10px] opacity-60">⏎</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

function LineItemRow({ item, suggestions, billId }) {
  const toast = useToast()
  const qc = useQueryClient()
  const suggestion = suggestions[0]

  async function confirmMatch() {
    const { error } = await supabase.rpc('confirm_material_match', { p_suggestion_id: suggestion.id })
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['supplier_bill_items', billId] })
    qc.invalidateQueries({ queryKey: ['material_match_suggestions', billId] })
  }
  async function rejectMatch() {
    await supabase.rpc('reject_material_match', { p_suggestion_id: suggestion.id })
    qc.invalidateQueries({ queryKey: ['material_match_suggestions', billId] })
  }

  return (
    <div className="border border-ink-100 rounded-md p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink-900">{item.description}</span>
        <span className="text-xs text-ink-500">{item.item_type}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-500 mt-1 tnum">
        <span>{item.quantity} {item.unit_text}</span>
        <span>@ {money(item.rate_inclusive)}</span>
        <span>GST {item.gst_percent}%</span>
        <span className="font-medium text-ink-900 ml-auto">{money(item.total_amount)}</span>
      </div>
      {suggestion && (
        <div className="flex items-center gap-2 mt-2 bg-ink-50 rounded px-2 py-1.5">
          <span className="text-xs text-ink-600">Match "{suggestion.inventory_items?.name}"?</span>
          <ConfidencePill value={suggestion.confidence} />
          <button className="btn-ghost text-xs px-1.5 py-0.5 ml-auto" onClick={confirmMatch}>Confirm</button>
          <button className="btn-ghost text-xs px-1.5 py-0.5" onClick={rejectMatch}>Reject</button>
        </div>
      )}
      {item.inventory_item_id && !suggestion && (
        <div className="mt-1.5"><Badge tone="ok">Matched to inventory</Badge></div>
      )}
    </div>
  )
}

function PaymentAllocation({ billId, payments, grandTotal }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState('cash')
  const [amount, setAmount] = useState('')
  const [utr, setUtr] = useState('')

  async function addPayment(e) {
    e.preventDefault()
    if (!amount) return
    const { error } = await supabase.from('supplier_bill_payments').insert({
      bill_id: billId, mode, allocated_amount: Number(amount), utr_reference: utr || null,
    })
    if (error) return toast.error(error.message)
    setAmount(''); setUtr('')
    qc.invalidateQueries({ queryKey: ['supplier_bill_payments', billId] })
  }

  const remaining = grandTotal - payments.reduce((s, p) => s + Number(p.allocated_amount), 0)

  return (
    <div>
      {payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ink-100 last:border-0">
          <span className="capitalize text-ink-700">{p.mode.replace('_', '/')}</span>
          <span className="tnum">{money(p.allocated_amount)}</span>
          <Badge tone={p.confirmed ? 'ok' : 'warn'}>{p.confirmed ? 'Confirmed' : p.mode === 'credit' ? 'Payable' : 'Instructed'}</Badge>
        </div>
      ))}
      <form onSubmit={addPayment} className="flex items-end gap-2 mt-2">
        <Select value={mode} onChange={(e) => setMode(e.target.value)} className="!w-28">
          <option value="cash">Cash</option><option value="rtgs_neft">RTGS/NEFT</option><option value="credit">Credit</option>
        </Select>
        <Input type="number" min="0" step="0.01" placeholder={`Remaining ${remaining.toFixed(0)}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
        {mode === 'rtgs_neft' && <Input placeholder="UTR" value={utr} onChange={(e) => setUtr(e.target.value)} className="w-24" />}
        <button className="btn-secondary text-xs" type="submit">Add</button>
      </form>
    </div>
  )
}
