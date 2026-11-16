import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard } from '../../components/ui'
import DateRangePicker, { presetRanges } from '../../components/DateRangePicker'
import BankStatement from '../../components/BankStatement'
import { money } from '../../lib/format'
import { displayDate } from '../../lib/dates'

const FAR_PAST = '2000-01-01'

function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Money moved by RTGS/NEFT only: payments matched to the bank statement (money out, at the bank's
// date and amount) and RTGS/NEFT collections (money in).
export default function RtgsLedger() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])

  const q = useQuery({
    queryKey: ['rtgs_ledger', start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rtgs_ledger', { p_start: start, p_end: end })
      if (error) throw error
      return data || []
    },
  })
  const priorQ = useQuery({
    queryKey: ['rtgs_ledger_prior', start],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rtgs_ledger', { p_start: FAR_PAST, p_end: dayBefore(start) })
      if (error) throw error
      return (data || []).reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * Number(r.amount), 0)
    },
  })

  const rows = q.data || []
  const paid = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0)
  const received = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0)

  const statementRows = [...rows].reverse().map((r) => ({
    key: `${r.reference_type}-${r.reference_id}`,
    date: r.txn_date,
    category: r.direction === 'in' ? 'Received' : 'Paid',
    description: [r.party, r.detail, r.project_name].filter(Boolean).join(' — '),
    reference: r.reference,
    direction: r.direction,
    amount: r.amount,
  }))

  return (
    <div>
      <PageHeader
        title="RTGS / NEFT Ledger"
        subtitle="Only money moved by RTGS/NEFT: payments once matched to the bank statement, and collections received by RTGS/NEFT."
      />
      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} /></Card>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Received" value={money(received)} />
        <StatCard label="Paid" value={money(paid)} />
        <StatCard label="Net" value={money(received - paid)} tone={received - paid < 0 ? 'bad' : undefined} />
      </div>
      <Card title="RTGS / NEFT statement">
        <BankStatement
          rows={statementRows}
          opening={priorQ.data || 0}
          loading={q.isLoading || priorQ.isLoading}
          exportName={`rtgs-neft-ledger-${start}-to-${end}`}
          pdfTitle="RTGS / NEFT ledger"
          subtitle="RTGS / NEFT only"
          period={`${displayDate(start)} – ${displayDate(end)}`}
        />
      </Card>
    </div>
  )
}
