import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock, Badge } from '../../components/ui'
import { money } from '../../lib/format'

// The accountant's five work queues (spec): different views of the same underlying records,
// not separate ledgers.
export default function AccountsOverview() {
  const q = useQuery({
    queryKey: ['accounts_overview'],
    queryFn: async () => {
      const [pending, unconfirmed, followups, risk] = await Promise.all([
        supabase.from('supplier_bills').select('id, grand_total').eq('status', 'pending_review'),
        supabase.from('supplier_bill_payments').select('id, allocated_amount, mode').eq('confirmed', false).eq('mode', 'rtgs_neft'),
        supabase.from('gst_invoice_followups').select('*, supplier_bills(internal_bill_number)').neq('status', 'closed').order('last_follow_up_at', { ascending: true, nullsFirst: true }).limit(8),
        supabase.rpc('report_itc_180day_risk'),
      ])
      return {
        pendingCount: pending.data?.length || 0,
        pendingTotal: (pending.data || []).reduce((s, b) => s + Number(b.grand_total), 0),
        unconfirmedCount: unconfirmed.data?.length || 0,
        unconfirmedTotal: (unconfirmed.data || []).reduce((s, p) => s + Number(p.allocated_amount), 0),
        followups: followups.data || [],
        risk: (risk.data || []).slice(0, 8),
      }
    },
  })

  if (q.isLoading) return <LoadingBlock />
  const d = q.data || {}

  return (
    <div>
      <PageHeader title="Accounts Overview" subtitle="Bills, payments, bank reconciliation, GST follow-up and ITC review — one picture." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 divide-x divide-ink-200 card p-4 mb-5">
        <div><StatCard label="Bills awaiting approval" value={d.pendingCount} sub={money(d.pendingTotal)} /></div>
        <div className="pl-4"><StatCard label="RTGS/NEFT unconfirmed" value={d.unconfirmedCount} sub={money(d.unconfirmedTotal)} tone={d.unconfirmedCount ? 'warn' : 'neutral'} /></div>
        <div className="pl-4"><StatCard label="GST follow-ups open" value={d.followups.length} /></div>
        <div className="pl-4"><StatCard label="180-day risk" value={d.risk.length} tone={d.risk.length ? 'bad' : 'neutral'} /></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Bills awaiting approval" actions={<Link to="/accounts/bills" className="text-xs text-ink-600 hover:underline">Open queue →</Link>}>
          {!d.pendingCount ? <EmptyState title="Nothing pending" /> : <div className="text-sm text-ink-700">{d.pendingCount} bill{d.pendingCount === 1 ? '' : 's'} totalling {money(d.pendingTotal)}.</div>}
        </Card>
        <Card title="Bank reconciliation" actions={<Link to="/accounts/bank" className="text-xs text-ink-600 hover:underline">Open →</Link>}>
          {!d.unconfirmedCount ? <EmptyState title="Nothing unconfirmed" /> : <div className="text-sm text-ink-700">{d.unconfirmedCount} RTGS/NEFT allocation{d.unconfirmedCount === 1 ? '' : 's'} awaiting a bank match.</div>}
        </Card>
        <Card title="GST invoice follow-up" actions={<Link to="/accounts/gst" className="text-xs text-ink-600 hover:underline">Open →</Link>}>
          {!d.followups.length ? <EmptyState title="Nothing open" /> : (
            <ul className="divide-y divide-ink-100">
              {d.followups.map((f) => (
                <li key={f.id} className="py-2 text-sm flex items-center justify-between">
                  <span>{f.supplier_bills?.internal_bill_number}</span>
                  <Badge tone="warn">{f.status.replace('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="ITC / 180-day review" actions={<Link to="/accounts/gst" className="text-xs text-ink-600 hover:underline">Open →</Link>}>
          {!d.risk.length ? <EmptyState title="Nothing at risk" /> : (
            <ul className="divide-y divide-ink-100">
              {d.risk.map((r) => (
                <li key={r.bill_id} className="py-2 text-sm flex items-center justify-between">
                  <span>{r.internal_bill_number} · {r.supplier_name}</span>
                  <span className="tnum">{r.days_elapsed}d</span>
                  <Badge tone={r.risk_level === 'breached' ? 'bad' : 'warn'}>{r.risk_level}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
