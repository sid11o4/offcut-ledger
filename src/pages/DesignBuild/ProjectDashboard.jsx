import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { money, qty } from '../../lib/format'
import { displayDate } from '../../lib/dates'
import { useToast } from '../../components/Toast'
import TransferModal from '../../components/TransferModal'
import { invalidateInventory } from '../../lib/queries'
import { useState } from 'react'

export default function ProjectDashboard() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const [transferOpen, setTransferOpen] = useState(false)

  const projectQ = useQuery({
    queryKey: ['design_project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('design_projects').select('*, clients(name), projects:factory_project_id(name, code)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const financialsQ = useQuery({
    queryKey: ['design_project_financials', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_design_project_financials', { p_design_project_id: id })
      if (error) throw error
      return data?.[0]
    },
  })

  const locationQ = useQuery({
    queryKey: ['design_project_location', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_locations').select('id').eq('design_project_id', id).single()
      if (error) throw error
      return data
    },
  })

  const stockQ = useQuery({
    queryKey: ['design_project_stock', id, locationQ.data?.id],
    enabled: !!locationQ.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_stock').select('*, inventory_items(name, units(code))')
        .eq('location_id', locationQ.data.id).gt('quantity', 0).order('quantity', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const txnQ = useQuery({
    queryKey: ['design_project_txns', id, locationQ.data?.id],
    enabled: !!locationQ.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions').select('*, inventory_items(name)')
        .eq('location_id', locationQ.data.id).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return data
    },
  })

  if (projectQ.isLoading) return <LoadingBlock />
  const p = projectQ.data
  const f = financialsQ.data || {}

  return (
    <div>
      <PageHeader
        title={p?.name}
        subtitle={`${p?.code} · ${p?.clients?.name || 'No client set'}`}
        actions={
          <>
            <StatusBadge status={p?.status} />
            <button className="btn-secondary" onClick={() => setTransferOpen(true)}>Transfer stock</button>
          </>
        }
      />

      <Card title="Financials" className="mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 divide-x divide-ink-200">
          <div><StatCard label="Budget" value={f.budget ? money(f.budget) : '—'} money /></div>
          <div className="pl-4"><StatCard label="Supplier Bills" value={money(f.supplier_bills_total)} money /></div>
          <div className="pl-4"><StatCard label="Internal Order (Factory job-work)" value={money(f.internal_order_total)} money /></div>
          <div className="pl-4"><StatCard label="Inventory on hand" value={money(f.current_inventory_value)} money /></div>
        </div>
        {p?.projects && (
          <div className="mt-4 pt-3 border-t border-ink-100 text-xs text-ink-500">
            Linked Factory project: <Link to={`/projects/${p.projects.id}`} className="text-ink-900 hover:underline">{p.projects.name}</Link> — job-work billed under Internal Order auto-posts material consumption here.
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Project inventory on hand">
          {!stockQ.data?.length ? <EmptyState title="No stock at this project" hint="Purchase directly into this project, or transfer from company inventory." /> : (
            <table className="table-base">
              <thead><tr><th>Material</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Value</th></tr></thead>
              <tbody>
                {stockQ.data.map((s) => (
                  <tr key={s.item_id}>
                    <td>{s.inventory_items?.name}</td>
                    <td className="num">{qty(s.quantity)} {s.inventory_items?.units?.code}</td>
                    <td className="num">{money(s.avg_unit_cost)}</td>
                    <td className="num font-medium">{money(s.quantity * s.avg_unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent inventory activity">
          {!txnQ.data?.length ? <EmptyState title="No movements yet" /> : (
            <ul className="divide-y divide-ink-100">
              {txnQ.data.map((t) => (
                <li key={t.id} className="py-2 text-sm flex items-center justify-between gap-2">
                  <div>
                    <div className="text-ink-900">{t.inventory_items?.name}</div>
                    <div className="text-xs text-ink-500">{t.txn_type.replace('_', ' ')} · {displayDate(t.txn_date)}</div>
                  </div>
                  <span className={`num font-medium ${t.quantity < 0 ? 'text-bad' : 'text-ok'}`}>
                    {t.quantity > 0 ? '+' : ''}{qty(t.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {transferOpen && (
        <TransferModal
          designProjectId={id}
          onClose={() => setTransferOpen(false)}
          onSaved={() => {
            toast.success('Transfer recorded.')
            invalidateInventory(qc)
            setTransferOpen(false)
          }}
        />
      )}
    </div>
  )
}
