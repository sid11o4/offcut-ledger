import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, ConfidencePill, EmptyState, LoadingBlock, Field, Input, Select } from '../../components/ui'
import { useSuppliers, useDesignProjects, useInventoryItems, invalidateInventory } from '../../lib/queries'
import { money } from '../../lib/format'

// Material lines are costed to one of these heads, the same groups the inventory is split into.
const MATERIAL_HEADS = [
  ['raw_boards', 'Raw Boards'], ['skins', 'Skins'], ['edgeband', 'Edgeband'], ['adhesives', 'Adhesives'],
  ['hardware', 'Hardware'], ['other', 'Others'], ['transport', 'Transport'], ['miscellaneous', 'Miscellaneous'],
]
const LABOUR_HEADS = [['factory_labour', 'Factory Labour'], ['site_labour', 'Site Labour'], ['employee_salary', 'Employee Salary']]
const COST_HEADS = [...MATERIAL_HEADS, ...LABOUR_HEADS]

const ANNEX_KINDS = [['vendor_bill', 'Vendor bill'], ['gst_invoice', 'GST invoice'], ['other', 'Other']]

// The scanner reads photos and PDFs. Other vendor papers (spreadsheets, Word files, text, other image
// formats) are attached to their bill as they are, without being scanned.
const SCANNABLE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
const UPLOAD_ACCEPT = 'image/*,application/pdf,.csv,.xls,.xlsx,.doc,.docx,.txt'
const SCAN_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

// A large photo is resized to at most 1800px on its long side before it is stored and scanned. The
// scanner reads the same text at that size, with far fewer image tokens, so each scan is faster.
async function shrinkForScan(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

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

// FORMGRID bill numbers are compared ignoring case, spaces and dashes, so "FG 2587" matches "FG-2587".
function billKey(number) {
  return String(number ?? '').replace(/[\s-]+/g, '').toUpperCase()
}

// Each line carries its own cost head. The bill's cost heads and expense nature are shown as a summary
// of those lines, so they are recalculated whenever a line changes.
async function syncBillFromLines(billId) {
  const { data: lines } = await supabase.from('supplier_bill_items').select('item_type, cost_head').eq('bill_id', billId).eq('pays_vendor_credit', false)
  if (!lines?.length) return
  const heads = [...new Set(lines.map((l) => l.cost_head).filter(Boolean))]
  const types = new Set(lines.map((l) => l.item_type))
  const nature = types.has('material') && types.has('labour') ? 'both' : types.has('labour') ? 'labour' : 'material'
  await supabase.from('supplier_bills').update({ cost_heads: heads, expense_nature: nature }).eq('id', billId)
}

// The bills an uploaded document can attach to: the slips in this upload, or, when there are none,
// the bill open in the queue.
async function billCandidates(slipBills, selectedId, rows) {
  if (slipBills.length) {
    const { data } = await supabase.from('supplier_bills').select('id, internal_bill_number')
      .in('id', slipBills.map((b) => b.id))
    return data || []
  }
  const selected = rows.find((r) => r.id === selectedId)
  return selected ? [{ id: selected.id, internal_bill_number: selected.internal_bill_number }] : []
}

// A document that carries a FORMGRID number belongs to that bill, or to none. A document with no
// number belongs to the only candidate, and to none when there are several.
function matchBill(number, candidates) {
  const key = billKey(number)
  if (key) return candidates.find((c) => billKey(c.internal_bill_number) === key) ?? null
  return candidates.length === 1 ? candidates[0] : null
}

export default function BillAuditQueue() {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(() => searchParams.get('bill'))
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
  async function createSlipBill(path, kind = 'slip') {
    const { data: bill, error: billErr } = await supabase.from('supplier_bills').insert({
      internal_bill_number: `PENDING-${Date.now().toString().slice(-6)}`,
      bill_date: new Date().toISOString().slice(0, 10),
      expense_nature: 'material', scan_image_path: path, created_by: profile.id,
      bill_source: kind === 'vendor' ? 'vendor' : 'formgrid',
    }).select().single()
    if (billErr) throw billErr
    const { data: fnResult, error: fnErr } = await supabase.functions.invoke('extract-supplier-bill-scan', { body: { bill_id: bill.id, kind } })
    if (fnErr) throw new Error(fnResult?.error || fnErr.message)
    if (fnResult?.error) throw new Error(fnResult.error)
    // The AI then proposes an inventory match for each material line; the auditor confirms them in review.
    if (kind === 'vendor') try { await supabase.functions.invoke('match-bill-items', { body: { bill_id: bill.id } }) } catch { /* matching can be run again from the bill */ }
    // A vendor bill's amount is owed to the vendor on credit until it is paid.
    if (kind === 'vendor') {
      const { data: scanned } = await supabase.from('supplier_bills').select('grand_total').eq('id', bill.id).single()
      const total = Number(scanned?.grand_total || 0)
      if (total > 0) {
        await supabase.from('supplier_bill_payments').insert({
          bill_id: bill.id, mode: 'credit', allocated_amount: total, created_by: profile.id,
        })
      }
    }
    return bill
  }

  // Each file is classified on its own, so one upload can mix kinds. A FORMGRID slip becomes a
  // bill and is scanned. A vendor bill, GST invoice or other document is attached to the bill whose
  // FORMGRID number it carries, which is written on top of it by hand. A document with no number
  // goes to the only bill it could belong to. Anything that matches no bill is not attached and is
  // listed, so it can be attached from that bill's details. If classification is unavailable, the
  // file is scanned as a slip, as it was before this step existed.
  // A scan takes each file as the kind chosen: a FORMGRID slip, or a vendor's own bill.
  async function handleScan(e, kind) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    // The files are scanned at the same time; each is reported on its own if it fails.
    const results = await Promise.all(files.map(async (file) => {
      try {
        if (!SCANNABLE_TYPES.includes(file.type)) throw new Error('Only photos (PNG, JPG, WEBP) and PDFs can be scanned.')
        const path = await storeBillFile(profile.id, await shrinkForScan(file))
        return await createSlipBill(path, kind)
      } catch (err) {
        toast.error(`${file.name}: ${err.message || err}`)
        return null
      }
    }))
    const created = results.filter(Boolean)
    setUploading(false)
    qc.invalidateQueries({ queryKey: ['supplier_bills_queue'] })
    if (created.length) {
      toast.success(`${created.length} ${kind === 'vendor' ? 'vendor' : 'FORMGRID'} bill${created.length === 1 ? '' : 's'} scanned — review below.`)
      setSelectedId(created[0].id)
    }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    const slipBills = []
    const docs = []
    let failed = 0
    for (const file of files) {
      try {
        const path = await storeBillFile(profile.id, file)
        const scannable = SCANNABLE_TYPES.includes(file.type)
        let c = { kind: scannable ? 'formgrid_slip' : 'other', formgrid_bill_number: null }
        if (scannable) {
          try {
            c = await classifyBillFile(path, file.type)
          } catch { /* unavailable: scan it as a slip */ }
        }
        if (c.kind === 'formgrid_slip') slipBills.push(await createSlipBill(path))
        // A vendor's own bill with no FORMGRID number is a bill in its own right.
        else if (scannable && (c.kind === 'vendor_bill' || c.kind === 'gst_invoice') && !billKey(c.formgrid_bill_number)) {
          slipBills.push(await createSlipBill(path, 'vendor'))
        } else docs.push({ path, file, kind: c.kind, number: c.formgrid_bill_number, scannable })
      } catch (err) {
        failed += 1
        toast.error(`${file.name}: ${err.message || err}`)
      }
    }

    // Slips take their final bill numbers from the scan, so match against those, not PENDING ones.
    const candidates = await billCandidates(slipBills, selectedId, rows)
    const byBill = new Map()
    const unmatched = []
    for (const d of docs) {
      const target = matchBill(d.number, candidates)
      if (!target) {
        // A vendor's own bill whose number matches no bill in this upload is a bill in its own right.
        if (d.scannable && (d.kind === 'vendor_bill' || d.kind === 'gst_invoice')) {
          try { slipBills.push(await createSlipBill(d.path, 'vendor')) } catch (err) { toast.error(`${d.file.name}: ${err.message || err}`) }
          continue
        }
        unmatched.push(d.file.name)
        continue
      }
      if (!byBill.has(target.id)) byBill.set(target.id, [])
      byBill.get(target.id).push({
        bill_id: target.id,
        kind: d.kind === 'vendor_bill' || d.kind === 'gst_invoice' ? d.kind : 'other',
        file_path: d.path,
        file_name: d.file.name,
        mime_type: d.file.type,
        size_bytes: d.file.size,
      })
    }
    let attached = 0
    for (const [billId, list] of byBill) {
      const { error } = await supabase.from('supplier_bill_annexures').insert(list)
      if (error) toast.error(error.message)
      else {
        attached += list.length
        qc.invalidateQueries({ queryKey: ['supplier_bill_annexures', billId] })
      }
    }
    if (unmatched.length) {
      toast.error(`${unmatched.join(', ')}: no bill in this upload carries its FORMGRID number. Attach ${unmatched.length === 1 ? 'it' : 'them'} from that bill's details.`)
    }
    if (attached) toast.success(`${attached} document${attached === 1 ? '' : 's'} attached as annexures`)

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
          <div className="flex items-center gap-2">
            <label className="btn-primary cursor-pointer">
              {uploading ? 'Scanning…' : 'Scan FORMGRID bill'}
              <input type="file" accept={SCAN_ACCEPT} multiple className="hidden" disabled={uploading}
                onChange={(e) => handleScan(e, 'slip')} />
            </label>
            <label className="btn-primary cursor-pointer">
              {uploading ? 'Scanning…' : 'Scan vendor bill'}
              <input type="file" accept={SCAN_ACCEPT} multiple className="hidden" disabled={uploading}
                onChange={(e) => handleScan(e, 'vendor')} />
            </label>
            <label className="btn-secondary cursor-pointer">
              {uploading ? 'Uploading…' : 'Upload documents'}
              <input
                ref={fileRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                multiple
                className="hidden"
                disabled={uploading}
                onChange={handleUpload}
            />
          </label>
          </div>
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

// Add a supplier right on the bill: name and details are prefilled from what the scan read and can
// be typed or corrected. Reuses a supplier that already has the same name, and links the bill to it.
function NewSupplierPrompt({ bill, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const d = bill.supplier_details || {}
  const [f, setF] = useState({
    name: (d.name || bill.supplier_text || '').trim(),
    gstin: d.gstin || '', phone: d.phone || '', address: d.address || '',
  })
  if (dismissed) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const name = f.name.trim()

  async function add() {
    setBusy(true)
    const { data: existing, error: findErr } = await supabase.from('suppliers').select('id')
      .ilike('name', name.replace(/[%_\\]/g, '\\$&')).limit(1)
    if (findErr) { setBusy(false); return toast.error(findErr.message) }
    let supplierId = existing?.[0]?.id
    if (!supplierId) {
      const { data, error } = await supabase.from('suppliers').insert({
        name, gstin: f.gstin.trim() || null, phone: f.phone.trim() || null, address: f.address.trim() || null,
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
    onClose?.()
  }

  function close() { setDismissed(true); onClose?.() }

  return (
    <div className="rounded-md border border-brand-500 bg-brand-100 p-3 text-sm">
      <div className="font-medium text-ink-950">{d.name || bill.supplier_text ? 'New supplier on this bill' : 'Add the vendor for this bill'}</div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className="field-input sm:col-span-2" placeholder="Supplier name" value={f.name} onChange={set('name')} />
        <input className="field-input" placeholder="GSTIN (optional)" value={f.gstin} onChange={set('gstin')} />
        <input className="field-input" placeholder="Phone (optional)" value={f.phone} onChange={set('phone')} />
        <input className="field-input sm:col-span-2" placeholder="Address (optional)" value={f.address} onChange={set('address')} />
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={add} disabled={busy || !name}>{busy ? 'Adding…' : 'Add supplier'}</button>
        <button className="btn-secondary" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}

function AuditPanel({ billId, onDone }) {
  const [matching, setMatching] = useState(false)
  async function matchWithAi() {
    setMatching(true)
    const { data, error } = await supabase.functions.invoke('match-bill-items', { body: { bill_id: billId } })
    setMatching(false)
    if (error || data?.error) return toast.error(data?.error || error.message)
    qc.invalidateQueries({ queryKey: ['material_match_suggestions', billId] })
    toast.success(data?.suggested ? `${data.suggested} match${data.suggested === 1 ? '' : 'es'} suggested — confirm them below.` : 'No inventory matches found.')
  }
  const [addingSupplier, setAddingSupplier] = useState(false)
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
  // The bill's own total leaves out lines that pay vendor credit, but their payment is still made through it.
  const creditLinesTotal = (itemsLineQ.data || []).filter((l) => l.pays_vendor_credit).reduce((sum, l) => sum + Number(l.total_amount || 0), 0)
  const grandTotal = Number(billQ.data?.grand_total || 0) + creditLinesTotal
  const reconciled = Math.abs(totalAllocated - grandTotal) < 0.01

  async function patchBill(patch) {
    const { error } = await supabase.from('supplier_bills').update(patch).eq('id', billId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['supplier_bill', billId] })
  }

  const approve = useCallback(async () => {
    if (saving) return
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
  }, [billId, toast, onDone, qc, saving])

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

  // The shortcuts always act on the latest bill and handlers, read through a ref, so a single listener
  // is enough. Keys are ignored only while typing in a text field; a dropdown or button that happens
  // to have focus does not block them.
  const actionsRef = useRef({})
  actionsRef.current = { approve, flag, deleteBill }
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      const typing = t instanceof HTMLElement && (
        t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(t.type))
      )
      if (typing) return
      if (e.key === 'Enter') { e.preventDefault(); actionsRef.current.approve() }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); actionsRef.current.flag() }
      else if (e.key === 'Delete') { e.preventDefault(); actionsRef.current.deleteBill() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
            <input type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" disabled={saving} onChange={addAnnexures} />
          </label>
        </Card>

        <Card title="Basic details">
          <div className="space-y-3">
            {billQ.data && (!billQ.data.supplier_id || addingSupplier) && <NewSupplierPrompt key={`${billQ.data.id}-${addingSupplier}`} bill={billQ.data} onClose={() => setAddingSupplier(false)} />}
            <div className="flex items-center justify-between gap-2">
              <Field label="Supplier">
                <Select value={b.supplier_id || ''} onChange={(e) => patchBill({ supplier_id: e.target.value || null })}>
                  <option value="">{b.supplier_text ? `"${b.supplier_text}" — unmatched` : 'Select…'}</option>
                  {(suppliersQ.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <button type="button" className="btn-ghost shrink-0" onClick={() => setAddingSupplier(true)}>+ New supplier</button>
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
            <Field label="Expense nature (indicative — follows the line items)">
              <Select value={b.expense_nature} onChange={(e) => patchBill({ expense_nature: e.target.value })}>
                <option value="material">Material</option><option value="labour">Labour</option><option value="both">Both</option>
              </Select>
            </Field>
            <div>
              <div className="field-label mb-1">Cost head (indicative — each line carries its own, below)</div>
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

        <Card title={`Line items (${itemsLineQ.data?.length || 0})`} actions={itemsLineQ.data?.length && b.bill_source !== 'formgrid' ? (
          <button className="btn-secondary text-xs" disabled={matching} onClick={matchWithAi}>{matching ? 'Matching…' : 'Match with inventory (AI)'}</button>
        ) : null}>
          {!itemsLineQ.data?.length ? <EmptyState title="No line items extracted" /> : (
            <div className="space-y-2">
              {itemsLineQ.data.map((li) => (
                <LineItemRow key={li.id} item={li} suggestions={(suggestionsQ.data || []).filter((s) => s.supplier_bill_item_id === li.id)} billId={billId} formgrid={b.bill_source === 'formgrid'} projects={projectsQ.data || []} billProjectId={b.design_project_id} />
              ))}
            </div>
          )}
          <div className="flex justify-between mt-3 pt-3 border-t border-ink-100 text-sm">
            <span className="text-ink-500">GST {money(b.tax_amount)} on {money(b.subtotal)}</span>
            <span className="font-semibold tnum">{money(b.grand_total)}</span>
          </div>
        </Card>

        <Card title="Payment allocation">
          <PaymentAllocation billId={billId} payments={paymentsQ.data || []} grandTotal={grandTotal} waiverAllowed={b.bill_source === 'formgrid'} />
          <div className="flex justify-between mt-3 pt-3 border-t border-ink-100 text-xs">
            <span className="text-ink-500">Allocated {money(totalAllocated)} of {money(grandTotal)}</span>
            <Badge tone={reconciled ? 'ok' : 'warn'}>{reconciled ? 'Amounts match' : 'Does not reconcile'}</Badge>
          </div>
        </Card>

        <div className="flex items-center gap-2 pt-1">
          <button className="btn-secondary" onClick={flag}>Flag issue <kbd className="ml-1 text-[10px] opacity-60">F</kbd></button>
          <button className="btn-secondary text-bad" onClick={deleteBill}>Delete bill <kbd className="ml-1 text-[10px] opacity-60">Del</kbd></button>
          <button className="btn-primary flex-1" disabled={saving} onClick={approve}>
            {saving ? 'Approving…' : 'Approve & next'} <kbd className="ml-1 text-[10px] opacity-60">⏎</kbd>
          </button>
        </div>
        <p className="text-[11px] text-ink-400">Shortcuts: Enter approve · F flag · Delete delete. Not active while typing in a text field.</p>
      </div>
    </div>
  )
}

function EditCell({ label, value, onSave, type = 'text', className = '', step }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-wide text-ink-400">{label}</span>
      <input
        className="field-input py-1 text-sm w-full" type={type} step={step} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (String(v) !== String(value ?? '')) onSave(v) }}
      />
    </label>
  )
}

function LineItemRow({ item, suggestions, billId, formgrid = false, projects = [], billProjectId = null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const itemsQ = useInventoryItems()
  const suggestion = suggestions[0]
  const [picking, setPicking] = useState(null) // an inventory item awaiting the "which title" choice
  const [manualId, setManualId] = useState('')
  const [skipGuess, setSkipGuess] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['supplier_bill_items', billId] })
    qc.invalidateQueries({ queryKey: ['supplier_bill', billId] })
    qc.invalidateQueries({ queryKey: ['material_match_suggestions', billId] })
  }

  // Every extracted field on the line can be corrected; totals recalculate from the saved values.
  async function patch(fields) {
    const { error } = await supabase.from('supplier_bill_items').update(fields).eq('id', item.id)
    if (error) return toast.error(error.message)
    await syncBillFromLines(billId)
    refresh()
  }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

  // The AI proposes the matching inventory item (match-bill-items); it is never applied silently: the
  // auditor confirms it and chooses which name the item keeps.
  const candidate = (() => {
    if (formgrid || item.item_type !== 'material' || item.inventory_item_id || skipGuess) return null
    if (suggestion?.suggested_inventory_item_id) {
      const inv = (itemsQ.data || []).find((i) => i.id === suggestion.suggested_inventory_item_id)
      if (inv) return { inv, confidence: suggestion.confidence, suggestionId: suggestion.id }
    }
    return null
  })()

  async function applyMatch(inv, keep) {
    // keep: 'bill' renames the inventory item to the bill's wording; 'inventory' keeps the inventory name.
    const fields = { inventory_item_id: inv.id }
    if (keep === 'inventory') { fields.description = inv.name }
    else if (item.description.trim() !== inv.name) {
      const { error } = await supabase.from('inventory_items').update({ name: item.description.trim() }).eq('id', inv.id)
      if (error) return toast.error(`Could not rename the inventory item: ${error.message}`)
      qc.invalidateQueries({ queryKey: ['inventory_items'] })
    }
    const { error } = await supabase.from('supplier_bill_items').update(fields).eq('id', item.id)
    if (error) return toast.error(error.message)
    if (candidate?.suggestionId) await supabase.rpc('confirm_material_match', { p_suggestion_id: candidate.suggestionId })
    setPicking(null)
    refresh()
  }
  async function rejectMatch() {
    if (candidate?.suggestionId) await supabase.rpc('reject_material_match', { p_suggestion_id: candidate.suggestionId })
    setSkipGuess(true)
    refresh()
  }
  async function unlink() { await patch({ inventory_item_id: null }) }

  const linked = item.inventory_item_id ? (itemsQ.data || []).find((i) => i.id === item.inventory_item_id) : null
  const inStockOptions = itemsQ.data || []

  return (
    <div className="border border-ink-100 rounded-md p-2.5">
      <div className="grid grid-cols-12 gap-2">
        <EditCell label="Description" className="col-span-12 sm:col-span-8" value={item.description} onSave={(v) => patch({ description: v.trim() || item.description, description_text: v.trim() || item.description })} />
        <label className="block col-span-12 sm:col-span-4">
          <span className="block text-[10px] uppercase tracking-wide text-ink-400">Type</span>
          <Select value={item.item_type} onChange={(e) => patch({ item_type: e.target.value, cost_head: null })} className="py-1 text-sm">
            <option value="material">material</option>
            <option value="labour">labour</option>
          </Select>
        </label>
        <EditCell label="Qty" type="number" step="any" className="col-span-4 sm:col-span-3" value={item.quantity} onSave={(v) => num(v) > 0 ? patch({ quantity: num(v) }) : toast.error('Quantity must be more than zero.')} />
        <EditCell label="Unit" className="col-span-4 sm:col-span-3" value={item.unit_text} onSave={(v) => patch({ unit_text: v.trim() || null })} />
        <EditCell label="Rate (incl. GST)" type="number" step="any" className="col-span-4 sm:col-span-3" value={item.rate_inclusive} onSave={(v) => patch({ rate_inclusive: Math.max(0, num(v)) })} />
        <EditCell label="GST %" type="number" step="any" className="col-span-6 sm:col-span-2" value={item.gst_percent} onSave={(v) => patch({ gst_percent: Math.max(0, num(v)), ...(num(v) > 0 ? { zero_gst_reason: null } : {}) })} />
        <div className="col-span-6 sm:col-span-1 flex items-end justify-end">
          <span className="text-sm font-medium text-ink-900 tnum">{money(item.total_amount)}</span>
        </div>
      </div>
      {formgrid && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-700">
          <input type="checkbox" checked={!!item.pays_vendor_credit} onChange={(e) => patch({ pays_vendor_credit: e.target.checked, ...(e.target.checked ? { cost_head: null, inventory_item_id: null } : {}) })} />
          Pays credit the vendor already holds. Only the payment is applied to their bills; no cost head, no cost, no inventory.
        </label>
      )}
      {!item.pays_vendor_credit && <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="text-xs text-ink-500">Project</span>
        <Select value={item.design_project_id || ''} onChange={(e) => patch({ design_project_id: e.target.value || null })} className="w-auto py-1 text-xs">
          <option value="">{billProjectId ? 'Same as the bill' : 'Same as the bill (Factory expense)'}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <span className="text-xs text-ink-500 ml-2">Cost head</span>
        <Select value={item.cost_head || ''} onChange={(e) => patch({ cost_head: e.target.value || null })} className="w-auto py-1 text-xs">
          <option value="">Not set</option>
          {(item.item_type === 'labour' ? LABOUR_HEADS : MATERIAL_HEADS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select>
        {!item.cost_head && <span className="text-xs text-ink-400">Needs a cost head</span>}
      </div>}

      {candidate && !picking && (
        <div className="flex flex-wrap items-center gap-2 mt-2 bg-ink-50 rounded px-2 py-1.5">
          <span className="text-xs text-ink-700">Is this <strong>{candidate.inv.name}</strong> in your inventory?</span>
          <ConfidencePill value={candidate.confidence} />
          <button className="btn-ghost text-xs px-1.5 py-0.5 ml-auto" onClick={() => setPicking(candidate.inv)}>Yes, that's it</button>
          <button className="btn-ghost text-xs px-1.5 py-0.5" onClick={rejectMatch}>No</button>
        </div>
      )}
      {picking && (
        <div className="mt-2 rounded border border-brand-500 bg-brand-100 p-2 text-xs">
          <div className="text-ink-950 font-medium">Which name should be kept?</div>
          <div className="mt-1 text-ink-700">Bill: <strong>{item.description}</strong></div>
          <div className="text-ink-700">Inventory: <strong>{picking.name}</strong></div>
          <div className="mt-2 flex gap-2">
            <button className="btn-primary text-xs" onClick={() => applyMatch(picking, 'bill')}>Keep the bill's name</button>
            <button className="btn-secondary text-xs" onClick={() => applyMatch(picking, 'inventory')}>Keep the inventory name</button>
            <button className="btn-ghost text-xs" onClick={() => setPicking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {!formgrid && item.item_type === 'material' && !item.inventory_item_id && (!candidate || skipGuess) && !picking && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-ink-500">Link to inventory</span>
          <Select value={manualId} onChange={(e) => {
            const inv = inStockOptions.find((i) => i.id === e.target.value)
            setManualId(e.target.value)
            if (inv) setPicking(inv)
          }} className="w-auto py-1 text-xs max-w-[16rem]">
            <option value="">Not linked (added as new)</option>
            {inStockOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
      )}
      {!formgrid && item.inventory_item_id && (
        <div className="mt-1.5 flex items-center gap-2">
          <Badge tone="ok">Matched to inventory{linked ? `: ${linked.name}` : ''}</Badge>
          <button className="btn-ghost text-xs px-1.5 py-0.5" onClick={unlink}>Unlink</button>
        </div>
      )}
    </div>
  )
}

const PAYMENT_LABEL = { cash: 'Cash', rtgs_neft: 'RTGS / NEFT', credit: 'Credit', waiver: 'Round off / waive off' }

function PaymentAllocation({ billId, payments, grandTotal, waiverAllowed = false }) {
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
          <span className="text-ink-700">{PAYMENT_LABEL[p.mode] || p.mode}</span>
          <span className="tnum">{money(p.allocated_amount)}</span>
          <Badge tone={p.confirmed ? 'ok' : 'warn'}>{p.confirmed ? 'Confirmed' : p.mode === 'credit' ? 'Payable' : 'Instructed'}</Badge>
        </div>
      ))}
      <form onSubmit={addPayment} className="flex items-end gap-2 mt-2">
        <Select value={mode} onChange={(e) => setMode(e.target.value)} className="!w-28">
          <option value="cash">Cash</option><option value="rtgs_neft">RTGS/NEFT</option><option value="credit">Credit</option>
          {waiverAllowed && <option value="waiver">Round off / waive off</option>}
        </Select>
        <Input type="number" min="0" step="0.01" placeholder={`Remaining ${remaining.toFixed(0)}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
        {mode === 'rtgs_neft' && <Input placeholder="UTR" value={utr} onChange={(e) => setUtr(e.target.value)} className="w-24" />}
        <button className="btn-secondary text-xs" type="submit">Add</button>
      </form>
    </div>
  )
}
