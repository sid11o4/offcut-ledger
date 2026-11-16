import { useQuery } from '@tanstack/react-query'
import { StatCard } from './ui'
import { loadPayReceive } from '../lib/payReceive'
import { money } from '../lib/format'

// Payables (owed to vendors and labour) and receivables (contract value still to be received).
// Shows the whole business, or one project when a project id is given.
export default function PayReceiveCards({ projectId = null }) {
  const q = useQuery({ queryKey: ['pay_receive'], queryFn: loadPayReceive })
  if (!q.data) return null
  const v = projectId ? q.data.byProject.get(projectId) : q.data.totals
  if (!v) return null
  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      <StatCard
        label="Payables"
        value={money(v.payables)}
        sub={`Vendors ${money(v.vendorPayable)} · labour ${money(v.labourPayable)}`}
        tone={v.payables > 0 ? 'bad' : 'neutral'}
      />
      <StatCard
        label="Receivables"
        value={money(v.receivable)}
        sub={`Contract ${money(v.contract)} · received ${money(v.received)}`}
        tone={v.receivable > 0 ? 'ok' : 'neutral'}
      />
    </div>
  )
}
