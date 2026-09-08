import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, StatCard, StatusBadge, EmptyState, LoadingBlock, Badge } from '../../components/ui'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

export default function ProjectDetail() {
  const { id } = useParams()
  const { hasPermission } = useAuth()

  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, clients(*), rate_categories(name)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
  })

  const finQ = useQuery({
    queryKey: ['project-financials', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_financials', { p_project_id: id })
      if (error) throw error
      return data?.[0]
    },
  })

  const entriesQ = useQuery({
    queryKey: ['project-entries', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_entries')
        .select('*, job_work_services(name)')
        .eq('project_id', id)
        .order('entry_date', { ascending: false })
        .limit(30)
      if (error) throw error
      return data
    },
  })

  const estimatesQ = useQuery({
    queryKey: ['project-estimates', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('estimates').select('*').eq('project_id', id).order('estimate_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const canSeeBills = hasPermission('billing') || hasPermission('financial_reports')
  const billsQ = useQuery({
    queryKey: ['project-bills', id],
    enabled: canSeeBills,
    queryFn: async () => {
      const { data, error } = await supabase.from('bills').select('*').eq('project_id', id).order('bill_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  if (projectQ.isLoading) return <LoadingBlock />
  if (projectQ.isError) return <EmptyState title="Project not found" />

  const project = projectQ.data
  const fin = finQ.data || {}
  const netContribution = Number(fin.actual_revenue || 0) - Number(fin.total_expenses || 0)

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={`${project.code} · ${project.clients?.name} · ${project.rate_categories?.name}`}
        actions={<StatusBadge status={project.status} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Actual Work Revenue" value={money(fin.actual_revenue)} tone="brand" />
        <StatCard label="Billed" value={money(fin.billed_revenue)} tone="ok" />
        <StatCard label="Unbilled" value={money(fin.unbilled_revenue)} tone="warn" />
        <StatCard label="Estimated Value" value={money(fin.estimated_value)} />
        <StatCard label="Expenses (Project)" value={money(fin.total_expenses)} tone="bad" />
        <StatCard label="Net Contribution" value={money(netContribution)} tone={netContribution >= 0 ? 'ok' : 'bad'} />
        <StatCard label="Start Date" value={displayDate(project.start_date)} />
        <StatCard label="Expected Completion" value={project.expected_completion_date ? displayDate(project.expected_completion_date) : '—'} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Recent Job Work">
          {entriesQ.isLoading ? <LoadingBlock /> : !entriesQ.data?.length ? <EmptyState title="No job-work entries yet" /> : (
            <div className="overflow-x-auto -mx-4">
              <table className="table-base">
                <thead><tr><th>Date</th><th>Service</th><th>Qty</th><th>Amount</th><th>Billing</th></tr></thead>
                <tbody>
                  {entriesQ.data.map((e) => (
                    <tr key={e.id} className={e.status === 'cancelled' ? 'opacity-40 line-through' : ''}>
                      <td>{displayDate(e.entry_date)}</td>
                      <td>{e.job_work_services?.name}</td>
                      <td>{qty(e.base_quantity)}</td>
                      <td>{money(e.total_amount)}</td>
                      <td>{e.status === 'cancelled' ? <Badge tone="bad">Cancelled</Badge> : e.billed ? <Badge tone="ok">Billed</Badge> : <Badge tone="warn">Unbilled</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 text-right">
            <Link to={`/reports/projects/${id}`} className="text-sm text-brand-700 hover:underline">Full project report →</Link>
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Estimates">
            {estimatesQ.isLoading ? <LoadingBlock /> : !estimatesQ.data?.length ? <EmptyState title="No estimates yet" /> : (
              <ul className="divide-y divide-ink-100">
                {estimatesQ.data.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between text-sm">
                    <Link to={`/estimates/${e.id}`} className="text-brand-700 hover:underline">{e.estimate_number}</Link>
                    <span className="text-ink-500">{displayDate(e.estimate_date)}</span>
                    <span className="font-medium">{money(e.grand_total)}</span>
                    <StatusBadge status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canSeeBills && (
            <Card title="Bills">
              {billsQ.isLoading ? <LoadingBlock /> : !billsQ.data?.length ? <EmptyState title="No bills yet" /> : (
                <ul className="divide-y divide-ink-100">
                  {billsQ.data.map((b) => (
                    <li key={b.id} className="py-2 flex items-center justify-between text-sm">
                      <Link to={`/billing/${b.id}`} className="text-brand-700 hover:underline">{b.bill_number}</Link>
                      <span className="text-ink-500">{displayDate(b.bill_date)}</span>
                      <span className="font-medium">{money(b.grand_total)}</span>
                      <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {project.notes && (
            <Card title="Notes">
              <p className="text-sm text-ink-700 whitespace-pre-wrap">{project.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
