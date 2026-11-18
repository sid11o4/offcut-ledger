import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { Card, EmptyState } from './ui'
import { invalidateInventory } from '../lib/queries'
import { displayDate } from '../lib/dates'
import { qty } from '../lib/format'

// The latest stock transfers into or out of this location, each with a Cancel button: the stock goes back where it
// came from (both sides together). Cancelling is refused if the stock has since been used up at the destination.
export default function RecentTransfers({ locationId, canOperate }) {
  const toast = useToast()
  const qc = useQueryClient()
  const companyQ = useQuery({
    queryKey: ['company_location_id'],
    enabled: !locationId,
    queryFn: async () => (await supabase.from('inventory_locations').select('id').eq('kind', 'company').single()).data?.id || null,
  })
  const locId = locationId || companyQ.data
  const q = useQuery({
    queryKey: ['recent_transfers', locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_transactions')
        .select('id, txn_type, quantity, txn_date, reference_id, item_id, location_id, inventory_items(name, units(code)), inventory_locations(name)')
        .in('txn_type', ['transfer_out', 'transfer_in']).is('reversed_by', null)
        .order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      const byKey = new Map()
      for (const t of data || []) {
        const key = `${t.reference_id}:${t.item_id}`
        const cur = byKey.get(key) || {}
        cur[t.txn_type === 'transfer_out' ? 'out' : 'in'] = t
        byKey.set(key, cur)
      }
      return [...byKey.values()]
        .filter((x) => x.out && x.in && (x.out.location_id === locId || x.in.location_id === locId))
        .slice(0, 15)
    },
  })

  async function cancel(x) {
    const reason = window.prompt(`Cancel the transfer of ${qty(Math.abs(x.out.quantity))} ${x.out.inventory_items?.name} from ${x.out.inventory_locations?.name} to ${x.in.inventory_locations?.name}? The stock goes back. Why?`)
    if (!reason?.trim()) return
    const { error } = await supabase.rpc('reverse_inventory_transaction', { p_txn_id: x.out.id, p_reason: reason.trim() })
    if (error) return toast.error(error.message)
    toast.success('Transfer cancelled. The stock is back where it came from.')
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['recent_transfers'] })
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
  }

  const rows = q.data || []
  if (!rows.length) return null
  return (
    <Card title="Recent transfers" className="mt-5">
      <table className="table-base">
        <thead><tr><th>Date</th><th>Material</th><th className="num">Quantity</th><th>From</th><th>To</th><th /></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={`${x.out.reference_id}:${x.out.item_id}`}>
              <td>{displayDate(x.out.txn_date)}</td>
              <td>{x.out.inventory_items?.name}</td>
              <td className="num">{qty(Math.abs(x.out.quantity))} {x.out.inventory_items?.units?.code}</td>
              <td>{x.out.inventory_locations?.name}</td>
              <td>{x.in.inventory_locations?.name}</td>
              <td className="text-right">{canOperate && <button className="btn-ghost text-xs px-2 text-bad" onClick={() => cancel(x)}>Cancel transfer</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
