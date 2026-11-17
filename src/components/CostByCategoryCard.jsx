import { useQuery } from '@tanstack/react-query'
import { Card, LoadingBlock } from './ui'
import CostBreakdown from './CostBreakdown'
import { loadCostBreakdown } from '../lib/costGroups'

// Cost by category for one Design Build project, or for all of Design Build when no project is given.
export default function CostByCategoryCard({ projectId = null, className = 'mb-5' }) {
  const q = useQuery({ queryKey: ['cost_breakdown', projectId], queryFn: () => loadCostBreakdown({ projectId }) })
  return (
    <Card title="Cost by category" className={className}>
      {q.isLoading ? <LoadingBlock /> : <CostBreakdown rows={q.data || []} />}
    </Card>
  )
}
