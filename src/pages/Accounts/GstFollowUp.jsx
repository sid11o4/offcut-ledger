import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock, Field, Input } from '../../components/ui'
import { money } from '../../lib/format'
import { displayDate } from '../../lib/dates'

export default function GstFollowUp() {
  const followupsQ = useQuery({
    queryKey: ['gst_followups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gst_invoice_followups')
        .select('*, supplier_bills(internal_bill_number, grand_total, bill_date, suppliers(name)), itc:supplier_bills(id)')
        .neq('status', 'closed').order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
  const riskQ = useQuery({
    queryKey: ['itc_180day_risk'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_itc_180day_risk')
      if (error) throw error
      return data
    },
  })

  return (
    <div>
      <PageHeader title="GST Invoice Follow-up" subtitle="Triggered when a bill has a GST line and an RTGS/NEFT allocation, until the official invoice is received and verified." />

      <Card title="Open follow-ups" className="mb-5">
        {followupsQ.isLoading ? <LoadingBlock /> : !followupsQ.data?.length ? (
          <EmptyState title="Nothing open" />
        ) : (
          <div className="space-y-2">
            {followupsQ.data.map((f) => <FollowupRow key={f.id} f={f} />)}
          </div>
        )}
      </Card>

      <Card title="180-day supplier-payment review">
        {riskQ.isLoading ? <LoadingBlock /> : !riskQ.data?.length ? (
          <EmptyState title="Nothing at risk" hint="No unpaid bill is within 30 days of the 180-day mark." />
        ) : (
          <table className="table-base">
            <thead><tr><th>Bill</th><th>Supplier</th><th className="num">Outstanding</th><th className="num">Days</th><th>Status</th></tr></thead>
            <tbody>
              {riskQ.data.map((r) => (
                <tr key={r.bill_id}>
                  <td>{r.internal_bill_number}</td>
                  <td>{r.supplier_name}</td>
                  <td className="num">{money(r.outstanding)}</td>
                  <td className="num">{r.days_elapsed}</td>
                  <td><Badge tone={r.risk_level === 'breached' ? 'bad' : 'warn'}>{r.risk_level}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function FollowupRow({ f }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')

  const itcQ = useQuery({
    queryKey: ['itc_status', f.bill_id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('itc_status').select('*').eq('bill_id', f.bill_id).single()
      if (error) throw error
      return data
    },
  })

  async function markReceived() {
    if (!invoiceNumber || !invoiceDate) return toast.error('Enter the official invoice number and date.')
    const { error } = await supabase.rpc('record_gst_invoice_received', {
      p_bill_id: f.bill_id, p_invoice_number: invoiceNumber, p_invoice_date: invoiceDate, p_image_path: null,
    })
    if (error) return toast.error(error.message)
    toast.success('Marked received — now pending verification.')
    qc.invalidateQueries({ queryKey: ['gst_followups'] })
    qc.invalidateQueries({ queryKey: ['itc_status', f.bill_id] })
  }

  async function setItc(patch) {
    const { error } = await supabase.from('itc_status').update(patch).eq('bill_id', f.bill_id)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['itc_status', f.bill_id] })
  }

  return (
    <div className="border border-ink-100 rounded-md p-3">
      <button className="w-full flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="text-sm text-ink-900">{f.supplier_bills?.internal_bill_number} · {f.supplier_bills?.suppliers?.name}</div>
          <div className="text-xs text-ink-500">{displayDate(f.supplier_bills?.bill_date)}</div>
        </div>
        <Badge tone={f.status === 'pending' ? 'warn' : f.status === 'received' ? 'brand' : 'ok'}>{f.status.replace('_', ' ')}</Badge>
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-ink-100 space-y-2">
          {f.status === 'pending' || f.status === 'contacted' ? (
            <div className="flex items-end gap-2">
              <Field label="Official invoice no."><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
              <button className="btn-secondary text-xs" onClick={markReceived}>Mark received</button>
            </div>
          ) : (
            <div className="text-xs text-ink-600">Invoice {f.official_invoice_number}, dated {displayDate(f.official_invoice_date)}.</div>
          )}
          {itcQ.data && (
            <div className="grid grid-cols-2 gap-2 text-xs pt-2">
              {['invoice_received', 'validity_checked', 'portal_matched', 'accountant_approved', 'claimed'].map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!!itcQ.data[k]} onChange={(e) => setItc({ [k]: e.target.checked })} />
                  {k.replace('_', ' ')}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
