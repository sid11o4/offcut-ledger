import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'

// Trades people start from; every trade already used by a contractor is added to the list too.
export const DEFAULT_TRADES = ['Carpenter', 'Painter', 'Mason', 'Electrician', 'Plumber', 'Tile worker', 'Polisher', 'Welder', 'Helper', 'General']
const NEW = '__new__'

// Picks a trade from the list, or adds a new one by typing it. A new trade is saved with its
// contractor and then appears in the list for everyone.
export default function TradeSelect({ value, onChange, className = 'field-input', required = false, placeholder = 'Trade' }) {
  const tradesQ = useQuery({
    queryKey: ['labour_trades'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_contractors').select('trade')
      if (error) throw error
      return data || []
    },
  })
  const options = [...new Set([...DEFAULT_TRADES, ...(tradesQ.data || []).map((r) => r.trade).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b))
  const [adding, setAdding] = useState(false)
  const typingNew = adding || (!!value && !options.includes(value))

  return (
    <div className="space-y-1">
      <select
        className={className}
        required={required && !typingNew}
        value={typingNew ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) { setAdding(true); onChange('') }
          else { setAdding(false); onChange(e.target.value) }
        }}
      >
        <option value="">{placeholder}…</option>
        {options.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value={NEW}>Add new trade…</option>
      </select>
      {typingNew && (
        <input
          className={className}
          autoFocus
          required={required}
          placeholder="New trade, e.g. Fabricator"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
