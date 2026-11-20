import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { invalidateInventory } from '../lib/queries'
import { qty } from '../lib/format'

// Editing a bill more than once used to take its stock out more than once (items showing "Short" that were never used).
// This lists what was taken out too many times and puts it back.
export default function StockRepairBanner({ locationId = null, canOperate }) {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['over_reversed_bill_stock'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('over_reversed_bill_stock')
      if (error) throw error
      return data || []
    },
  })
  const rows = (q.data || []).filter((r) => !locationId || r.location_id === locationId)
  if (!rows.length || !canOperate) return null

  async function repair() {
    if (!window.confirm(`Put back the stock that was taken out too many times for ${rows.length} item${rows.length === 1 ? '' : 's'}?`)) return
    const { data, error } = await supabase.rpc('repair_over_reversed_bill_stock')
    if (error) return toast.error(error.message)
    toast.success(`Stock put back for ${data} item${data === 1 ? '' : 's'}.`)
    invalidateInventory(qc)
    qc.invalidateQueries({ queryKey: ['over_reversed_bill_stock'] })
    qc.invalidateQueries({ queryKey: ['company_inventory_value'] })
  }

  return (
    <div className="mb-5 rounded-md border border-ink-200 bg-pill-warn-bg p-4 text-sm">
      <div className="font-medium text-ink-950">Some stock was taken out more than once when a bill was edited</div>
      <p className="text-ink-700 mt-1">These items show as short only because of that, not because they were used. Repairing puts the extra quantity back.</p>
      <ul className="mt-2 text-xs text-ink-700 space-y-0.5 max-h-40 overflow-y-auto">
        {rows.map((r) => <li key={`${r.item_id}-${r.location_id}`}>{r.item_name} · {r.location_name} · <span className="tnum">{qty(r.quantity)}</span> to put back</li>)}
      </ul>
      <button className="btn-primary mt-3" onClick={repair}>Repair stock</button>
    </div>
  )
}
