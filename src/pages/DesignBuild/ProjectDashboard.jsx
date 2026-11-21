import { useParams, Link, useNavigate } from 'react-router-dom'
import CostByCategoryCard from '../../components/CostByCategoryCard'
import ProjectSpendTiles from '../../components/ProjectSpendTiles'
import { loadProjectSpend } from '../../lib/projectSpend'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatusBadge, EmptyState, LoadingBlock } from '../../components/ui'
import { money, qty } from '../../lib/format'
import { displayDate } from '../../lib/dates'
import { useToast } from '../../components/Toast'
import TransferModal from '../../components/TransferModal'
import { invalidateInventory, useInventoryLocations, useInventoryItems } from '../../lib/queries'
import MergeItemsModal from '../../components/MergeItemsModal'
import { Fragment, useState } from 'react'
import MaterialSources from './MaterialSources'
import TrackProgressCard from '../../components/TrackProgressCard'

export default function ProjectDashboard() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const [transferOpen, setTransferOpen] = useState(false)
  const [returning, setReturning] = useState(null)
  const [openItem, setOpenItem] = useState(null)
  const [mergeItem, setMergeItem] = useState(null)
  const allItemsQ = useInventoryItems()
  const companyLocationsQ = useInventoryLocations()
  const companyLocationId = (companyLocationsQ.data || []).find((l) => l.kind === 'company')?.id
  const navigate = useNavigate()

  // Leftover stock moves to Company inventory and the project leaves the active lists. The database
  // refuses while bills are still waiting for review.
  async function completeProject() {
    if (!window.confirm(`Mark ${projectQ.data?.name} complete? Any stock left on the project moves to Company inventory.`)) return
    const { data: moved, error } = await supabase.rpc('complete_design_project', { p_project_id: id })
    if (error) return toast.error(error.message)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['design_project', id] })
    toast.success(moved ? `${projectQ.data?.name} completed. ${moved} stock line${moved === 1 ? '' : 's'} moved to Company inventory.` : `${projectQ.data?.name} completed.`)
    navigate('/design-build/projects')
  }

  // The database refuses the delete while the project has bills, slips or stock locations, and
  // says why, so that message is what the user sees.
  async function deleteProject() {
    if (!window.confirm(`Delete ${projectQ.data?.name}? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_design_project', { p_project_id: id })
    if (error) return toast.error(error.message)
    invalidateInventory(qc)
    toast.success(`${projectQ.data?.name} deleted`)
    navigate('/design-build/projects')
  }

  const projectQ = useQuery({
    queryKey: ['design_project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('design_projects').select('*, clients(name), projects:factory_project_id(name, code)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const spendQ = useQuery({ queryKey: ['project_spend', id], queryFn: async () => (await loadProjectSpend()).get(id) })
  const financialsQ = useQuery({
    queryKey: ['design_project_financials', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_design_project_financials', { p_design_project_id: id })
      if (error) throw error
      return data?.[0]
    },
  })

  const contractQ = useQuery({
    queryKey: ['project_contract', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_contract_summary', { p_design_project_id: id })
      if (error) throw error
      return data?.[0] || {}
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
        .eq('location_id', locationQ.data.id).neq('quantity', 0).order('quantity', { ascending: false })
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

  // A mistaken entry is reversed, not deleted. Bill purchases and factory consumption are corrected
  // where they were made, so they cannot be reversed here.
  function canReverse(t) {
    if (t.reversed_by) return false
    if (t.reference_type === 'supplier_bill' || t.reference_type === 'internal_order') return false
    if (t.reference_type === 'adjustment' && t.reference_id) return false
    return true
  }

  async function reverseEntry(t) {
    const reason = window.prompt(`Reverse this entry: ${t.inventory_items?.name} ${t.quantity > 0 ? '+' : ''}${qty(t.quantity)}. Why? (It stays in the record, marked reversed.)`)
    if (!reason) return
    const { error } = await supabase.rpc('reverse_inventory_transaction', { p_txn_id: t.id, p_reason: reason })
    if (error) return toast.error(error.message)
    toast.success('Entry reversed.')
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['design_project_txns', id] })
    qc.invalidateQueries({ queryKey: ['design_project_stock', id] })
    qc.invalidateQueries({ queryKey: ['design_project', id] })
    qc.invalidateQueries({ queryKey: ['design_project_financials', id] })
    qc.invalidateQueries({ queryKey: ['project_spend'] })
    qc.invalidateQueries({ queryKey: ['project_ceo_raw', id] })
  }

  if (projectQ.isLoading) return <LoadingBlock />
  const p = projectQ.data

  return (
    <div>
      <PageHeader
        title={p?.name}
        subtitle={`${p?.code} · ${p?.clients?.name || 'No client set'}`}
        actions={
          <>
            <StatusBadge status={p?.status} />
            <Link className="btn-secondary" to={`/design-build/projects/${id}/collections`}>Collections</Link>
            <Link className="btn-secondary" to={`/design-build/projects/${id}/report`}>Project report</Link>
            <button className="btn-secondary" onClick={() => setTransferOpen(true)}>Transfer stock</button>
            {p?.status !== 'completed' && <button className="btn-secondary" onClick={completeProject}>Mark complete</button>}
            <button className="btn-danger" onClick={deleteProject}>Delete project</button>
          </>
        }
      />

      <TrackProgressCard projectId={id} />
      <ProjectSpendTiles spend={spendQ.data} contract={contractQ.data?.contract_total} />

      <CostByCategoryCard projectId={id} />

      {p?.projects && (
        <p className="mb-5 text-xs text-ink-500">
          Linked Factory project: <Link to={`/projects/${p.projects.id}`} className="text-ink-900 hover:underline">{p.projects.name}</Link> — job-work billed under Design Build Order auto-posts material consumption here.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Project inventory on hand">
          {!stockQ.data?.length ? <EmptyState title="No stock at this project" hint="Purchase directly into this project, or transfer from company inventory." /> : (
            <table className="table-base">
              <thead><tr><th>Material</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Value</th><th /></tr></thead>
              <tbody>
                {stockQ.data.map((s) => (
                  <Fragment key={s.item_id}>
                  <tr className="cursor-pointer" onClick={() => setOpenItem(openItem === s.item_id ? null : s.item_id)}>
                    <td>{s.inventory_items?.name} <span className="text-xs text-ink-500">{openItem === s.item_id ? '· hide sources' : '· sources'}</span></td>
                    <td className={`num ${s.quantity < 0 ? 'text-bad' : ''}`}>{qty(s.quantity)} {s.inventory_items?.units?.code}{s.quantity < 0 && <span className="ml-1 text-xs">short</span>}</td>
                    <td className="num">{money(s.avg_unit_cost)}</td>
                    <td className="num font-medium">{money(s.quantity * s.avg_unit_cost)}</td>
                    <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost text-xs px-2" title="Merge with another item" onClick={() => setMergeItem((allItemsQ.data || []).find((i) => i.id === s.item_id))}>Merge</button>
                      {s.quantity > 0 ? (
                        <>
                          <button className="btn-ghost text-xs px-2" onClick={() => setReturning(s)}>Move to company</button>
                          <button className="btn-ghost text-xs px-2" onClick={() => navigate(`/design-build/returns?location=${locationQ.data?.id ?? ''}&item=${s.item_id}&qty=${s.quantity}`)}>Return to vendor</button>
                        </>
                      ) : <span className="text-xs text-ink-500">Used before it was bought</span>}
                    </td>
                  </tr>
                  {openItem === s.item_id && (
                    <tr>
                      <td colSpan={5} className="bg-ink-50"><MaterialSources itemId={s.item_id} projectId={id} /></td>
                    </tr>
                  )}
                  </Fragment>
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
                    <div className={`text-ink-900 ${t.reversed_by ? 'line-through text-ink-500' : ''}`}>{t.inventory_items?.name}</div>
                    <div className="text-xs text-ink-500">
                      {t.reference_type === 'adjustment' && t.reference_id ? 'reversal' : t.txn_type.replace('_', ' ')} · {displayDate(t.txn_date)}
                      {t.reversed_by && ' · reversed'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`num font-medium ${t.quantity < 0 ? 'text-bad' : 'text-ok'}`}>
                      {t.quantity > 0 ? '+' : ''}{qty(t.quantity)}
                    </span>
                    {canReverse(t) && (
                      <button className="btn-ghost text-xs px-2" onClick={() => reverseEntry(t)}>Reverse</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {mergeItem && <MergeItemsModal item={mergeItem} onClose={() => setMergeItem(null)} />}
      {returning && (
        <TransferModal
          title="Move to company inventory"
          designProjectId={id}
          initial={{ item_id: returning.item_id, from: locationQ.data?.id, to: companyLocationId, quantity: returning.quantity }}
          onClose={() => setReturning(null)}
          onSaved={() => {
            toast.success(`${returning.inventory_items?.name} returned to company inventory.`)
            invalidateInventory(qc)
            setReturning(null)
          }}
        />
      )}
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
