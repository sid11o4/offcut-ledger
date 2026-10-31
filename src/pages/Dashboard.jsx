import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { PageHeader, Card, Tile, StatusBadge, EmptyState, LoadingBlock } from '../components/ui'
import { today, startOfThisMonth, displayDate } from '../lib/dates'
import { money } from '../lib/format'

// The Factory dashboard: job-work, billing and expenses only. Design Build has its own dashboard.
export default function Dashboard() {
  const { hasPermission } = useAuth()
  const t = today()
  const monthStart = startOfThisMonth()

  const todayQ = useQuery({
    queryKey: ['dash-today', t],
    queryFn: async () => {
      const [entries, expenses] = await Promise.all([
        supabase.from('job_work_entries').select('total_amount, project_id, status').eq('entry_date', t),
        supabase.from('expenses').select('amount, status').eq('expense_date', t),
      ])
      if (entries.error) throw entries.error
      if (expenses.error) throw expenses.error
      const active = entries.data.filter((e) => e.status === 'active')
      return {
        revenue: active.reduce((s, e) => s + Number(e.total_amount), 0),
        expenses: expenses.data.filter((e) => e.status === 'active').reduce((s, e) => s + Number(e.amount), 0),
        jobs: active.length,
        projects: new Set(active.map((e) => e.project_id)).size,
      }
    },
  })

  const monthQ = useQuery({
    queryKey: ['dash-month', monthStart, t],
    queryFn: async () => {
      const [rev, billing, expenses] = await Promise.all([
        supabase.rpc('report_revenue_by_project', { p_start: monthStart, p_end: t }),
        supabase.rpc('report_billing_status', { p_start: monthStart, p_end: t }),
        supabase.from('expenses').select('amount').eq('status', 'active').gte('expense_date', monthStart).lte('expense_date', t),
      ])
      if (rev.error) throw rev.error
      if (billing.error) throw billing.error
      if (expenses.error) throw expenses.error
      const revenue = rev.data.reduce((s, r) => s + Number(r.revenue), 0)
      const expenseTotal = expenses.data.reduce((s, e) => s + Number(e.amount), 0)
      return { revenue, expenseTotal, byProject: rev.data, billing: billing.data?.[0] }
    },
  })

  const opsQ = useQuery({
    queryKey: ['dash-ops', monthStart, t],
    queryFn: async () => {
      const [process, machine, category] = await Promise.all([
        supabase.rpc('report_revenue_by_process', { p_start: monthStart, p_end: t }),
        supabase.rpc('report_revenue_by_machine', { p_start: monthStart, p_end: t }),
        supabase.rpc('report_revenue_by_rate_category', { p_start: monthStart, p_end: t }),
      ])
      return { process: process.data || [], machine: machine.data || [], category: category.data || [] }
    },
  })

  const canSeeFinancials = hasPermission('billing') || hasPermission('financial_reports')
  const financialQ = useQuery({
    queryKey: ['dash-financial'],
    enabled: canSeeFinancials,
    queryFn: async () => {
      const [bills, estimates] = await Promise.all([
        supabase.from('bills').select('*, projects(name)').order('bill_date', { ascending: false }).limit(5),
        supabase.from('estimates').select('*, projects(name)').order('estimate_date', { ascending: false }).limit(5),
      ])
      return { bills: bills.data || [], estimates: estimates.data || [] }
    },
  })

  const recentExpensesQ = useQuery({
    queryKey: ['dash-recent-expenses'],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('*, expense_categories(name)').eq('status', 'active').order('expense_date', { ascending: false }).limit(5)
      return data || []
    },
  })

  const todayNet = (todayQ.data?.revenue || 0) - (todayQ.data?.expenses || 0)
  const monthNet = (monthQ.data?.revenue || 0) - (monthQ.data?.expenseTotal || 0)

  return (
    <div>
      <PageHeader title="Factory Dashboard" subtitle="Job-work, billing and expenses" />

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-800">Today</h2>
        {todayQ.isLoading ? <LoadingBlock /> : (
          <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Revenue" value={money(todayQ.data?.revenue)} />
            <Tile label="Expenses" value={money(todayQ.data?.expenses)} />
            <Tile label="Net" value={money(todayNet)} sub={todayNet >= 0 ? 'In profit today' : 'Spent more than earned'} />
            <Tile label="Jobs · projects worked" value={`${todayQ.data?.jobs || 0} · ${todayQ.data?.projects || 0}`} />
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-800">This month</h2>
        {monthQ.isLoading ? <LoadingBlock /> : (
          <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Revenue" value={money(monthQ.data?.revenue)} />
            <Tile label="Expenses" value={money(monthQ.data?.expenseTotal)} />
            <Tile label="Net contribution" value={money(monthNet)} sub={monthNet >= 0 ? 'Ahead for the month' : 'Behind for the month'} />
            <Tile label="Unbilled work" value={money(monthQ.data?.billing?.unbilled_revenue)} sub="Done but not yet billed" />
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Revenue by project (this month)">
          {!monthQ.data?.byProject?.length ? <EmptyState title="No revenue yet" /> : (
            <ul className="space-y-2">
              {monthQ.data.byProject.slice(0, 8).map((r) => (
                <li key={r.project_id} className="flex justify-between text-sm">
                  <Link to={`/projects/${r.project_id}`} className="hover:underline">{r.project_name}</Link>
                  <span className="tnum font-medium">{money(r.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Revenue by process (this month)">
          {!opsQ.data?.process?.length ? <EmptyState title="No data" /> : (
            <ul className="space-y-2">
              {opsQ.data.process.map((r) => (
                <li key={r.process_id} className="flex justify-between text-sm"><span>{r.process_name}</span><span className="tnum font-medium">{money(r.revenue)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Revenue by rate category (this month)">
          {!opsQ.data?.category?.length ? <EmptyState title="No data" /> : (
            <ul className="space-y-2">
              {opsQ.data.category.map((r) => (
                <li key={r.rate_category_id} className="flex justify-between text-sm"><span>{r.rate_category_name}</span><span className="tnum font-medium">{money(r.revenue)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {canSeeFinancials && (
          <Card title="Recent bills">
            {financialQ.isLoading ? <LoadingBlock /> : !financialQ.data?.bills.length ? <EmptyState title="No bills yet" /> : (
              <ul className="divide-y divide-ink-100">
                {financialQ.data.bills.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                    <Link to={`/billing/${b.id}`} className="text-brand-700 hover:underline">{b.bill_number}</Link>
                    <span className="tnum font-medium">{money(b.grand_total)}</span>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Recent estimates">
          {financialQ.isLoading && canSeeFinancials ? <LoadingBlock /> : !financialQ.data?.estimates?.length ? <EmptyState title="No estimates yet" /> : (
            <ul className="divide-y divide-ink-100">
              {financialQ.data?.estimates.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                  <Link to={`/estimates/${e.id}`} className="text-brand-700 hover:underline">{e.estimate_number}</Link>
                  <span className="tnum font-medium">{money(e.grand_total)}</span>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent expenses">
          {recentExpensesQ.isLoading ? <LoadingBlock /> : !recentExpensesQ.data?.length ? <EmptyState title="No expenses yet" /> : (
            <ul className="divide-y divide-ink-100">
              {recentExpensesQ.data.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{x.expense_categories?.name} <span className="text-ink-400">· {displayDate(x.expense_date)}</span></span>
                  <span className="tnum font-medium">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
