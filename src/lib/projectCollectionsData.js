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
