import { EmptyState } from './ui'
import { groupCosts } from '../lib/costGroups'
import { money } from '../lib/format'

// Labour, Materials (split into its kinds), Factory Job Work, Transport and Miscellaneous, with each
// group's share of the total. Materials list its sub-groups beneath it.
export default function CostBreakdown({ rows, showPlaces = false }) {
  const { groups, grand } = groupCosts(rows)
  if (!grand) return <EmptyState title="No costs recorded" />
  const pct = (v, of) => (of ? `${((v / of) * 100).toFixed(1)}%` : '—')
  return (
    <table className="table-base">
      <thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
      <tbody>
        {groups.map((g) => (
          <GroupRows key={g.name} g={g} grand={grand} pct={pct} showPlaces={showPlaces} />
        ))}
      </tbody>
      <tfoot><tr><td className="font-medium">Total</td><td className="num font-medium">{money(grand)}</td><td /></tr></tfoot>
    </table>
  )
}

function GroupRows({ g, grand, pct, showPlaces }) {
  return (
    <>
      <tr className="bg-ink-50">
        <td className="font-medium">{g.name}</td>
        <td className="num font-medium">{money(g.total)}</td>
        <td className="num">{pct(g.total, grand)}</td>
      </tr>
      {g.subs && g.subs.map((s) => (
        <tr key={s.name}>
          <td className="pl-8 text-ink-700">{s.name}</td>
          <td className="num">{money(s.amount)}</td>
          <td className="num text-ink-500">{pct(s.amount, g.total)}</td>
        </tr>
      ))}
      {showPlaces && [...g.places.entries()].sort((a, b) => b[1] - a[1]).map(([place, amount]) => (
        <tr key={`${g.name}-${place}`}>
          <td className="pl-8 text-xs text-ink-500">{place}</td>
          <td className="num text-xs text-ink-500">{money(amount)}</td>
          <td className="num text-xs text-ink-500">{pct(amount, g.total)}</td>
        </tr>
      ))}
    </>
  )
}
