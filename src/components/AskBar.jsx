import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// One input for the whole app: ask a question, attach a bill or photo, or ask for a change.
// Answers come back as a summary, supporting tables with links, and follow-ups. Requests to
// create, change or delete a supplier bill come back as a review screen: where the change lands,
// what it changes from and to, and Enter to approve. Nothing is saved until the user approves,
// and assistant-execute re-checks the caller's permissions.

const MAX_BYTES = 4 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

const PATHS = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  up: 'M12 19V5M5 12l7-7 7 7',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  retry: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
}

function Icon({ name, className = '' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  )
}

const ACTION = {
  create_bill: { label: 'Create', tone: 'badge-brand', title: 'Review the new bill', approve: 'Approve and save' },
  update_bill: { label: 'Change', tone: 'badge-warn', title: 'Review the change', approve: 'Approve and change' },
  delete_bill: { label: 'Delete', tone: 'badge-bad', title: 'Review the deletion', approve: 'Approve and delete' },
}

const SCOPE = {
  factory: { label: 'Factory', tone: 'badge-neutral' },
  design_build: { label: 'Design Build', tone: 'badge-brand' },
  both: { label: 'Factory + Design Build', tone: 'badge-neutral' },
}

const MODE_LABEL = { cash: 'Cash', rtgs_neft: 'RTGS / NEFT', credit: 'Credit' }
const CHANGE_LABEL = { bill_date: 'Bill date', grand_total: 'Total', remarks: 'Remarks', supplier_name: 'Supplier', project_name: 'Project' }

// supabase-js reports any non-2xx as "Edge Function returned a non-2xx status code" and keeps the
// real JSON error on fnError.context; read it so the user sees the actual reason.
async function invokeError(fnError) {
  try {
    const body = await fnError.context?.json()
    if (body?.error) return body.error
  } catch { /* body was not JSON */ }
  return fnError.message
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function money(v) {
  return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

// Amounts, counts and dates line up right and use tabular figures; prose stays left.
function isNumeric(v) {
  const s = String(v ?? '').trim()
  return /\d/.test(s) && /^[\s₹+\-()\d.,%/]+$/.test(s)
}

function labelFor(key) {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function isTyping(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable
}

// The bill as it is now, so the review can show "now" next to "after". Read through the caller's
// own session, so a bill they cannot see simply has no current values.
async function loadCurrent(p) {
  if (p.action_type === 'create_bill' || !p.bill_number) return null
  const { data } = await supabase.from('supplier_bills')
    .select('internal_bill_number, bill_date, grand_total, remarks, supplier_text, status')
    .eq('internal_bill_number', p.bill_number).maybeSingle()
  return data
}

// Rows for the review table. A supplier or project that is not on file is flagged isNew and shown
// in red as "(a new one will be created)", because approving will create it.
function reviewRows(p) {
  const cur = p.current
  const row = (field, now, after, isNew = false) => ({
    field,
    now,
    after: isNew ? `${after} (a new one will be created)` : after,
    isNew,
  })
  if (p.action_type === 'create_bill') {
    const rows = [
      row('Supplier', '—', p.supplier_name, Boolean(p.create_supplier)),
      row('Project', '—', p.project_name || 'Factory expense', Boolean(p.project_name && p.create_project)),
      row('Bill date', '—', p.bill_date || 'Today'),
      row('Total', '—', p.grand_total != null ? money(p.grand_total) : '—'),
    ]
    if (p.remarks) rows.push(row('Remarks', '—', p.remarks))
    const payRows = (p.payments || []).map((pay, i) => row(
      `Payment ${i + 1}`,
      '—',
      `${MODE_LABEL[pay.mode] ?? pay.mode} · ${money(pay.amount)}${pay.utr_reference ? ` · UTR ${pay.utr_reference}` : ''}`,
    ))
    return [...rows, ...payRows]
  }
  if (p.action_type === 'delete_bill') {
    return [
      row('Supplier', cur?.supplier_text || '—', 'Removed'),
      row('Bill date', cur?.bill_date || '—', 'Removed'),
      row('Total', cur ? money(cur.grand_total) : '—', 'Removed'),
    ]
  }
  const before = {
    bill_date: cur?.bill_date,
    grand_total: cur ? money(cur.grand_total) : undefined,
    remarks: cur?.remarks,
    supplier_name: cur?.supplier_text,
  }
  return Object.entries(p.changes || {}).map(([k, v]) => row(
    CHANGE_LABEL[k] ?? labelFor(k),
    before[k] || '—',
    k === 'grand_total' ? money(v) : String(v),
    (k === 'supplier_name' && Boolean(p.create_supplier)) || (k === 'project_name' && Boolean(p.create_project)),
  ))
}

// True when a supplier or project name is not on file, so approving will create it.
async function isNewRecord(table, name) {
  const n = String(name ?? '').trim()
  if (!n) return false
  const { data } = await supabase.from(table).select('id').ilike('name', n.replace(/[%_\\]/g, '\\$&')).limit(1)
  return !(data?.length)
}

// Adds what the review needs: the current bill and which supplier or project is new.
async function withReviewContext(p) {
  const next = { ...p, current: await loadCurrent(p) }
  if (p.action_type === 'create_bill') {
    if (p.supplier_name) next.create_supplier = Boolean(p.create_supplier) || await isNewRecord('suppliers', p.supplier_name)
    if (p.project_name) next.create_project = Boolean(p.create_project) || await isNewRecord('design_projects', p.project_name)
  }
  if (p.action_type === 'update_bill') {
    if (p.changes?.supplier_name) next.create_supplier = Boolean(p.create_supplier) || await isNewRecord('suppliers', p.changes.supplier_name)
    if (p.changes?.project_name) next.create_project = Boolean(p.create_project) || await isNewRecord('design_projects', p.changes.project_name)
  }
  return next
}

export default function AskBar() {
  const [question, setQuestion] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [asked, setAsked] = useState('')
  const [result, setResult] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const cardRef = useRef(null)
  const lastQuestion = useRef('')

  const panelOpen = Boolean(busy || result || error || proposal || outcome)
  const canSubmit = !busy && Boolean(question.trim() || file)
  const meta = proposal ? ACTION[proposal.action_type] : null
  // Which business this is for. A bill with no project is a Factory expense.
  const scope = result?.scope ?? (proposal ? (proposal.project_name ? 'design_build' : 'factory') : null)

  const close = useCallback(() => {
    setResult(null)
    setError(null)
    setProposal(null)
    setOutcome(null)
  }, [])

  // Image thumbnail for the attachment; the object URL is released when the file changes.
  useEffect(() => {
    if (!file?.type.startsWith('image/')) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // When a review opens, move focus onto it so Enter approves it, and the question field is left alone.
  useEffect(() => {
    if (!proposal) return
    inputRef.current?.blur()
    cardRef.current?.focus()
  }, [proposal])

  // "/" focuses the bar from anywhere; Escape closes the panel (never mid-save).
  useEffect(() => {
    function onKey(e) {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && panelOpen && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, busy, close])

  // Enter approves while the review has focus. A focused button keeps its own Enter behaviour.
  useEffect(() => {
    if (!proposal) return
    function onEnter(e) {
      if (e.key !== 'Enter' || busy) return
      if (e.target !== cardRef.current && e.target !== document.body) return
      e.preventDefault()
      approve()
    }
    window.addEventListener('keydown', onEnter)
    return () => window.removeEventListener('keydown', onEnter)
  }, [proposal, busy])

  // Clicking away closes a plain answer, but never a review the user has not decided on.
  useEffect(() => {
    function onDown(e) {
      if (!wrapRef.current?.contains(e.target) && !busy && !proposal) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [busy, proposal, close])

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_BYTES) { setError('That file is over 4 MB. Attach a smaller photo or PDF.'); return }
    setFile(f)
  }

  async function ask(e, overrideQuestion) {
    e?.preventDefault()
    const q = (overrideQuestion ?? question).trim()
    if (!q && !file) return
    lastQuestion.current = q
    setBusy(true)
    setAsked(q || file?.name || '')
    setError(null)
    setResult(null)
    setProposal(null)
    setOutcome(null)
    try {
      const body = { question: q }
      if (file) body.attachment = { mime: file.type, base64: await readAsBase64(file) }
      const { data, error: fnError } = await supabase.functions.invoke('assistant-query', { body })
      if (fnError) throw new Error(await invokeError(fnError))
      if (data?.error) throw new Error(data.error)
      if (data.proposal) setProposal(await withReviewContext(data.proposal))
      else setResult(data.answer)
    } catch (err) {
      setError(err.message || 'Could not get an answer.')
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (busy || !proposal) return
    setBusy(true)
    setError(null)
    try {
      const action = { ...proposal, type: proposal.action_type }
      const { data, error: fnError } = await supabase.functions.invoke('assistant-execute', { body: { action } })
      if (fnError) throw new Error(await invokeError(fnError))
      if (data?.error) throw new Error(data.error)
      setOutcome(data.message)
      setProposal(null)
    } catch (err) {
      setError(err.message || 'Could not save the change.')
    } finally {
      setBusy(false)
    }
  }

  function followUp(text) {
    setQuestion(text)
    ask(null, text)
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <form
        onSubmit={ask}
        className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 transition-colors focus-within:border-ink-400 focus-within:ring-2 focus-within:ring-ink-900/15"
      >
        <Icon name="search" className="text-ink-400" />
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={file ? 'Ask about this file, or press Enter' : 'Ask about the business, or attach a bill'}
          aria-label="Ask the assistant"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a bill or photo"
          title="Attach a bill or photo (PNG, JPG, WEBP or PDF, up to 4 MB)"
          className="btn-ghost h-8 w-8 p-0 active:scale-[0.97] transition-transform"
        >
          <Icon name="clip" />
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Ask"
          className="btn-primary h-8 w-8 p-0 active:scale-[0.97] transition-transform"
        >
          <Icon name="up" />
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={pickFile} />
      </form>

      {file && (
        <div className="mt-2 flex items-center gap-3 rounded-md border border-ink-200 bg-white p-2 text-sm">
          {preview ? (
            <img src={preview} alt="" className="h-10 w-10 shrink-0 rounded border border-ink-200 object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-ink-100 text-ink-600">
              <Icon name="file" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-ink-950">{file.name}</div>
            <div className="tnum text-xs text-ink-500">
              {file.type === 'application/pdf' ? 'PDF' : 'Image'} · {formatBytes(file.size)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
            className="btn-ghost h-8 w-8 p-0"
          >
            <Icon name="x" />
          </button>
        </div>
      )}

      {!panelOpen && !file && (
        <p className="mt-1.5 hidden px-1 text-xs text-ink-400 sm:block">
          Press <kbd className="rounded border border-ink-200 px-1 font-mono text-[11px]">/</kbd> to focus,
          {' '}<kbd className="rounded border border-ink-200 px-1 font-mono text-[11px]">Enter</kbd> to ask,
          {' '}<kbd className="rounded border border-ink-200 px-1 font-mono text-[11px]">Esc</kbd> to close
        </p>
      )}

      {panelOpen && (
        <div
          role="region"
          aria-live="polite"
          className="ask-in absolute left-0 right-0 z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-800 shadow-[0_16px_40px_-16px_rgba(10,10,10,0.22)]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {scope && <span className={SCOPE[scope].tone}>{SCOPE[scope].label}</span>}
              <p className="min-w-0 truncate text-xs text-ink-500">{asked}</p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="btn-ghost h-7 w-7 shrink-0 p-0">
              <Icon name="x" />
            </button>
          </div>

          {busy && (
            <div>
              <div className="space-y-2.5" aria-hidden="true">
                <div className="h-3.5 w-11/12 animate-pulse rounded bg-ink-100" />
                <div className="h-3.5 w-8/12 animate-pulse rounded bg-ink-100" />
                <div className="h-3.5 w-6/12 animate-pulse rounded bg-ink-100" />
              </div>
              <p className="mt-3 text-sm text-ink-500">{proposal ? 'Saving…' : 'Checking the books…'}</p>
            </div>
          )}

          {!busy && error && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-bad">
                <Icon name="alert" className="mt-0.5" />
                <p className="text-ink-950">{error}</p>
              </div>
              <button type="button" onClick={() => ask(null, lastQuestion.current)} className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs">
                <Icon name="retry" /> Retry
              </button>
            </div>
          )}

          {!busy && outcome && (
            <div className="flex items-start gap-2 text-ink-950">
              <Icon name="check" className="mt-0.5 text-ok" />
              <p>{outcome}</p>
            </div>
          )}

          {!busy && proposal && meta && (
            <div ref={cardRef} tabIndex={-1} className="outline-none">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-ink-950">{meta.title}</h3>
                <span className={meta.tone}>{meta.label}</span>
              </div>
              <p className="mt-1.5 leading-relaxed text-ink-800">{proposal.summary}</p>

              <dl className="mt-4 grid grid-cols-3 divide-x divide-ink-100 rounded-md border border-ink-200">
                <div className="px-3 py-2">
                  <dt className="text-xs text-ink-500">Screen</dt>
                  <dd className="mt-0.5">
                    <Link to="/accounts/bills" onClick={close} className="text-brand-700 hover:underline">Bill Audit Queue</Link>
                  </dd>
                </div>
                <div className="min-w-0 px-3 py-2">
                  <dt className="text-xs text-ink-500">Record</dt>
                  <dd className="tnum mt-0.5 truncate text-ink-950">
                    {proposal.action_type === 'create_bill' ? 'New bill' : `Bill ${proposal.bill_number}`}
                  </dd>
                </div>
                <div className="px-3 py-2">
                  <dt className="text-xs text-ink-500">Status</dt>
                  <dd className="mt-0.5 text-ink-950">
                    {proposal.action_type === 'create_bill' ? 'Pending review'
                      : proposal.action_type === 'delete_bill' ? 'Removed'
                      : proposal.current?.status ?? '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 overflow-x-auto rounded-md border border-ink-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Now</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows(proposal).map(({ field, now, after, isNew }, i) => (
                      <tr key={i}>
                        <td className="text-ink-600">{field}</td>
                        <td className={isNumeric(now) ? 'num text-ink-500' : 'text-ink-500'}>{now}</td>
                        <td className={`font-medium ${isNew ? 'text-bad' : 'text-ink-950'} ${isNumeric(after) ? 'num' : ''}`}>{after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs text-ink-500">
                  <kbd className="rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">Enter</kbd> to approve
                  <span aria-hidden="true">·</span>
                  <kbd className="rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">Esc</kbd> to cancel
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
                  <button type="button" className={proposal.action_type === 'delete_bill' ? 'btn-danger' : 'btn-primary'} onClick={approve}>
                    {meta.approve}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!busy && result && (
            <div>
              <p className="text-base leading-relaxed text-ink-950">{result.summary}</p>
              {result.not_permitted && (
                <p className="mt-3 flex items-start gap-2 text-xs text-warn">
                  <Icon name="alert" className="mt-px" />
                  Part of this answer is hidden because your account does not have access to it.
                </p>
              )}
              {(result.sections || []).map((s, i) => (
                <section key={i} className="mt-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-medium text-ink-950">{s.title}</h4>
                    {s.link && (
                      <Link to={s.link} onClick={close} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                        Open <Icon name="arrow" className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-md border border-ink-200">
                    <table className="table-base">
                      <thead>
                        <tr>
                          {s.columns.map((c, j) => (
                            <th key={j} className={j > 0 && s.rows.length && s.rows.every((r) => isNumeric(r[j])) ? 'num' : ''}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.rows.map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, c) => (
                              <td key={c} className={isNumeric(cell) ? 'num' : ''}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              {result.follow_ups?.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {result.follow_ups.map((f, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => followUp(f)}
                      className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100 active:scale-[0.97]"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
