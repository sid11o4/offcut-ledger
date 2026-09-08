import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { displayDate } from '../../lib/dates'
import { money } from '../../lib/format'

export default function BillingHome() {
  const { hasPermission } = useAuth()

  const billsQ = useQuery({
    queryKey: ['bills'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bills').select('*, clients(name), projects(name)').order('bill_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const unbilledQ = useQuery({
    queryKey: ['unbilled-by-project'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('project_id, total_amount, projects(name, code)')
        .eq('status', 'active')
        .eq('billed', false)
      if (error) throw error
      const map = new Map()
      for (const r of data) {
        const cur = map.get(r.project_id) || { name: r.projects?.name, code: r.projects?.code, amount: 0 }
        cur.amount += Number(r.total_amount)
        map.set(r.project_id, cur)
      }
      return [...map.entries()].map(([projectId, v]) => ({ projectId, ...v })).sort((a, b) => b.amount - a.amount)
    },
  })

  const bills = billsQ.data || []
  const totalBilled = bills.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + Number(b.grand_total), 0)
  const totalUnbilled = (unbilledQ.data || []).reduce((s, r) => s + r.amount, 0)

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Generate bills from actual, unbilled job-work — never from manually entered totals."
        actions={hasPermission('billing') && <Link to="/billing/new" className="btn-primary">+ New Bill</Link>}
      />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Total Billed (all bills)" value={money(totalBilled)} tone="ok" />
        <StatCard label="Total Unbilled Work" value={money(totalUnbilled)} tone="warn" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="Bills">
            {billsQ.isLoading ? <LoadingBlock /> : !bills.length ? <EmptyState title="No bills yet" /> : (
              <div className="overflow-x-auto -mx-4">
                <table className="table-base">
                  <thead><tr><th>Bill #</th><th>Date</th><th>Client</th><th>Project</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.id}>
                        <td><Link to={`/billing/${b.id}`} className="text-brand-700 font-medium hover:underline">{b.bill_number}</Link></td>
                        <td>{displayDate(b.bill_date)}</td>
                        <td>{b.clients?.name}</td>
                        <td>{b.projects?.name}</td>
                        <td className="font-medium">{money(b.grand_total)}</td>
                        <td><StatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <Card title="Unbilled by Project">
          {unbilledQ.isLoading ? <LoadingBlock /> : !unbilledQ.data?.length ? <EmptyState title="Everything is billed" /> : (
            <ul className="divide-y divide-ink-100">
              {unbilledQ.data.map((r) => (
                <li key={r.projectId} className="py-2 flex items-center justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="font-medium text-warn">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
