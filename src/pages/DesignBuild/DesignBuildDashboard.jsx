import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, Tile, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { money } from '../../lib/format'
import { displayDate } from '../../lib/dates'

// The Design Build dashboard: the interior business on its own. Completed projects drop out of
// the project cards, though their stock is already in Company inventory and counted there.
export default function DesignBuildDashboard() {
  const summaryQ = useQuery({
    queryKey: ['db-dash-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_design_projects_summary')
      if (error) throw error
      return data || []
    },
  })

  const companyQ = useQuery({
    queryKey: ['db-dash-company'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_company_inventory_value')
      if (error) throw error
      return data || []
    },
  })

  const pendingQ = useQuery({
    queryKey: ['db-dash-pending'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_bills')
        .select('id, internal_bill_number, grand_total, supplier_text, bill_date')
        .eq('status', 'pending_review').order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const projects = summaryQ.data || []
  const live = projects.filter((p) => p.status !== 'completed')
  const completedCount = projects.length - live.length
  const projectStock = projects.reduce((s, p) => s + Number(p.current_inventory_value || 0), 0)
  const companyStock = (companyQ.data || []).reduce((s, r) => s + Number(r.value || 0), 0)
  const approvedSpend = projects.reduce((s, p) => s + Number(p.supplier_bills_total || 0), 0)
  const pending = pendingQ.data || []
  const pendingTotal = pending.reduce((s, b) => s + Number(b.grand_total || 0), 0)

  return (
    <div>
      <PageHeader
        title="Design Build Dashboard"
        subtitle="Projects, inventory and supplier accounts"
        actions={(
          <>
            <Link to="/accounts/bills" className="btn-secondary">Scan bill</Link>
            <Link to="/design-build/projects" className="btn-primary">New project</Link>
          </>
        )}
      />

      {summaryQ.isLoading || companyQ.isLoading || pendingQ.isLoading ? <LoadingBlock /> : (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Active projects" value={live.length} sub={`${completedCount} completed`} />
          <Tile label="Inventory on hand" value={money(projectStock + companyStock)} sub="Company pool and project sites" to="/design-build/inventory" />
          <Tile label="Approved spend" value={money(approvedSpend)} sub="Approved supplier bills" />
          <Tile label="Awaiting review" value={pending.length} sub={pending.length ? money(pendingTotal) : 'Nothing waiting'} to="/accounts/bills" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-ink-800">Projects</h2>
          {summaryQ.isLoading ? <LoadingBlock /> : !live.length ? (
            <Card>
              <EmptyState title="No active projects" hint="Create one with New project." />
            </Card>
          ) : (
            <div className="stagger grid gap-4 md:grid-cols-2">
              {live.map((p) => {
                const spend = Number(p.supplier_bills_total || 0) + Number(p.internal_order_total || 0)
                const budget = Number(p.budget || 0)
                const progress = budget > 0 ? spend / budget : null
                return (
                  <Link key={p.id} to={`/design-build/projects/${p.id}`} className="card card-interactive block p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-ink-400">{p.code}</div>
                        <div className="mt-0.5 truncate text-base font-medium text-ink-950">{p.name}</div>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-ink-500">Spent</div>
                        <div className="tnum font-medium text-ink-950">{money(spend)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-ink-500">On hand</div>
                        <div className="tnum font-medium text-ink-950">{money(p.current_inventory_value)}</div>
                      </div>
                    </div>
                    {progress == null ? (
                      <div className="mt-4 text-xs text-ink-400">No budget set</div>
                    ) : (
                      <>
                        <div
                          role="img"
                          aria-label={`${Math.round(progress * 100)}% of budget used`}
                          className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-100"
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ease-out ${progress > 1 ? 'bg-bad' : 'bg-ink-900'}`}
                            style={{ width: `${Math.min(progress, 1) * 100}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-ink-500">{Math.round(progress * 100)}% of {money(budget)} budget</div>
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <Card title="Awaiting review">
          {pendingQ.isLoading ? <LoadingBlock /> : !pending.length ? <EmptyState title="All bills reviewed" /> : (
            <ul className="divide-y divide-ink-100">
              {pending.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-ink-950">{b.supplier_text || 'Unidentified supplier'}</div>
                    <div className="tnum text-xs text-ink-500">{b.internal_bill_number} · {displayDate(b.bill_date)}</div>
                  </div>
                  <span className="tnum shrink-0 font-medium">{money(b.grand_total)}</span>
                </li>
              ))}
            </ul>
          )}
          {pending.length > 8 && (
            <Link to="/accounts/bills" className="mt-3 inline-block text-xs text-brand-700 hover:underline">
              View all {pending.length} in the queue
            </Link>
          )}
        </Card>
      </div>
    </div>
  )
}
