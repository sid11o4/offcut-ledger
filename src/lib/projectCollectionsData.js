import { supabase } from './supabaseClient'
import { buildTableDoc, saveDoc } from './reportPdf'
import { displayDate } from './dates'
import { money } from './format'

// A project's receivables: its quotations, scope of work, and the payments collected against it.
export async function loadCollections(projectId) {
  const [projR, sumR, quotR, scopeR, collR] = await Promise.all([
    supabase.from('design_projects').select('id, code, name, clients(name)').eq('id', projectId).single(),
    supabase.rpc('project_contract_summary', { p_design_project_id: projectId }),
    supabase.from('project_quotations').select('*').eq('design_project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('project_scope_items').select('*').eq('design_project_id', projectId).order('created_at'),
    supabase.from('project_collections').select('*').eq('design_project_id', projectId).order('receipt_date', { ascending: false }).order('created_at', { ascending: false }),
  ])
  for (const r of [projR, sumR, quotR, scopeR, collR]) if (r.error) throw r.error
  const s = sumR.data?.[0] || {}
  const contract = Number(s.contract_total || 0)
  const received = (collR.data || []).filter((c) => !c.voided).reduce((t, c) => t + Number(c.amount), 0)
  return {
    project: projR.data,
    contract,
    received,
    balance: contract - received,
    quotations: quotR.data || [],
    scope: scopeR.data || [],
    receipts: collR.data || [],
  }
}

// A FORMGRID receipt for one payment, in the house style.
export function receiptPdf({ project, collection, summary }) {
  const doc = buildTableDoc({
    title: 'Payment receipt',
    subtitle: collection.receipt_no,
    meta: [
      ['Date', displayDate(collection.receipt_date)],
      ['Project', `${project.name} (${project.code})`],
      ['Client', project.clients?.name || '—'],
    ],
    cards: [
      ['Amount received', money(collection.amount)],
      ['Contract value', money(summary.contract)],
      ['Balance due', money(summary.balance)],
    ],
    sections: [
      {
        heading: 'Receipt',
        head: [['Receipt no.', 'Received from', 'Mode', 'Reference', 'Amount']],
        body: [[
          collection.receipt_no,
          collection.received_from || '—',
          collection.mode.replace('_', '/'),
          collection.reference || '—',
          money(collection.amount),
        ]],
      },
      ...(collection.notes ? [{ heading: 'Notes', head: [['Note']], body: [[collection.notes]] }] : []),
    ],
  })
  return doc
}

export function downloadReceipt(args) {
  saveDoc(receiptPdf(args), `receipt-${args.collection.receipt_no}`)
}

// Quotation reading: the Claude-read lines of a quotation, and how they change the scope of work.
const keyOf = (desc) => String(desc || '').trim().toLowerCase().replace(/\s+/g, ' ')

export async function readQuotation(quotationId) {
  const { data, error } = await supabase.functions.invoke('extract-project-quotation', { body: { quotation_id: quotationId } })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data.extracted
}

// The rows that would bring the scope of work in line with a quotation revision.
// First quotation (empty scope): every line becomes an original scope line.
// Later revision: lines that are new are added, lines whose amount moved are added or reduced by
// the difference, and scope lines the new quotation no longer has are reduced to zero.
export function revisionRows({ scope, quotation, label }) {
  const lines = (quotation.extracted?.items || []).filter((l) => l && l.description)
  const note = `Per quotation ${quotation.extracted?.quote_number || label || ''}`.trim()
  if (!scope.length) {
    return lines.map((l) => ({
      kind: 'original', description: l.description, unit_text: l.unit || null,
      quantity: Number(l.quantity ?? 1), rate: Number(l.rate ?? l.amount ?? 0), amount: Number(l.amount || 0),
      note: null, source_quotation_id: quotation.id,
    }))
  }
  const current = new Map()
  for (const s of scope) {
    const k = keyOf(s.description)
    const c = current.get(k) || { description: s.description, amount: 0 }
    c.amount += Number(s.amount || 0)
    current.set(k, c)
  }
  const wanted = new Map()
  for (const l of lines) {
    const k = keyOf(l.description)
    const w = wanted.get(k) || { description: l.description, unit: l.unit, amount: 0 }
    w.amount += Number(l.amount || 0)
    wanted.set(k, w)
  }
  const rows = []
  const push = (kind, description, delta) => {
    const amount = Math.round(delta * 100) / 100
    rows.push({ kind, description, unit_text: null, quantity: 1, rate: amount, amount, note, source_quotation_id: quotation.id })
  }
  for (const [k, w] of wanted) {
    const delta = w.amount - (current.get(k)?.amount || 0)
    if (Math.abs(delta) < 0.5) continue
    push(delta > 0 ? 'added' : 'reduced', w.description, delta)
  }
  for (const [k, c] of current) {
    if (wanted.has(k) || Math.abs(c.amount) < 0.5) continue
    push('reduced', c.description, -c.amount)
  }
  return rows
}

export async function applyQuotation({ quotation, rows }) {
  if (rows.length) {
    const { error } = await supabase.from('project_scope_items').insert(rows.map((r) => ({ ...r, design_project_id: quotation.design_project_id })))
    if (error) throw new Error(error.message)
  }
  const { error } = await supabase.from('project_quotations').update({ applied_at: new Date().toISOString() }).eq('id', quotation.id)
  if (error) throw new Error(error.message)
}
