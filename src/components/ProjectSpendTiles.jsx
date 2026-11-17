import { money } from '../lib/format'

// The project dashboard's headline figures, at the top of the page: what has been spent by kind, the total,
// the contract value and how much of it is spent. Tiles flow onto as many columns as fit and the figures
// scale with the tile, so nothing overlaps at any width.
function Tile({ label, value, sub, tone, wide, children }) {
  const toneClass = tone === 'bad' ? 'text-bad' : 'text-ink-950'
  return (
    <div className={`card min-w-0 p-4 ${wide ? 'sm:col-span-2' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1.5 break-words font-semibold leading-tight tabular-nums text-[clamp(1.15rem,1.7vw,1.6rem)] ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
      {children}
    </div>
  )
}

export default function ProjectSpendTiles({ spend, contract }) {
  const s = spend || { labour: 0, materials: 0, factory: 0, other: 0, inventory: 0, spent: 0 }
  const contractValue = Number(contract || 0)
  const used = contractValue > 0 ? s.spent / contractValue : null
  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Materials spend" value={money(s.materials)} sub="Materials consumed" />
      <Tile label="Labour spend" value={money(s.labour)} />
      <Tile label="Factory spend" value={money(s.factory)} sub="Factory job work" />
      <Tile label="Other spend" value={money(s.other)} sub="Transport, miscellaneous" />
      <Tile label="Project inventory" value={money(s.inventory)} sub="Stock held at the project" />
      <Tile label="Total spend" value={money(s.spent)} sub="All costs + project inventory" tone="bad" />
      <Tile label="Contract value" value={contractValue ? money(contractValue) : '—'} sub={contractValue ? undefined : 'No contract value yet'} />
      <Tile
        label="Contract value spent"
        value={used == null ? '—' : `${(used * 100).toFixed(1)}%`}
        sub={used == null ? undefined : `${money(contractValue - s.spent)} left of the contract`}
        tone={used != null && used > 1 ? 'bad' : undefined}
      >
        {used != null && (
          <div role="img" aria-label={`${Math.round(used * 100)}% of the contract spent`} className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className={`h-full rounded-full ${used > 1 ? 'bg-bad' : 'bg-ink-900'}`} style={{ width: `${Math.min(used, 1) * 100}%` }} />
          </div>
        )}
      </Tile>
    </div>
  )
}
