import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../components/ui'
import DateRangePicker, { presetRanges } from '../components/DateRangePicker'
import { money } from '../lib/format'

export default function IncomeExpenseStatement() {
  const preset = presetRanges()['This month']
  const [start, setStart] = useState(preset[0])
  const [end, setEnd] = useState(preset[1])
  const [synced, setSynced] = useState(false)

  // Ensure any recurring expense due within/at the end of this period has been generated
  // before we read the statement — otherwise a report run before anyone opened Recurring
  // Expenses this period would silently under-count fixed costs.
  useEffect(() => {
    setSynced(false)
    supabase.rpc('sync_recurring_expenses', { p_as_of: end }).finally(() => setSynced(true))
  }, [end])

  const statementQ = useQuery({
    queryKey: ['income_expense_statement', start, end, synced],
    enabled: synced,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('income_expense_statement', { p_start: start, p_end: end })
      if (error) throw error
      return data?.[0]
    },
  })

  const breakdownQ = useQuery({
    queryKey: ['expense_breakdown', start, end, synced],
    enabled: synced,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expense_breakdown_by_category', { p_start: start, p_end: end })
      if (error) throw error
      return data
    },
  })

  const s = statementQ.data

  return (
    <div>
      <PageHeader title="Income / Expense Statement" subtitle="Reconciles exactly with the underlying job-work and expense transactions for the chosen period." />

      <Card className="mb-5"><DateRangePicker start={start} end={end} onChange={(a, b) => { setStart(a); setEnd(b) }} /></Card>

      {!synced || statementQ.isLoading ? <LoadingBlock /> : !s ? <EmptyState title="No data" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <StatCard label="Income (job work)" value={money(s.job_work_income)} tone="brand" />
            <StatCard label="Total Expenses" value={money(s.total_expenses)} tone="bad" />
            <StatCard label="Net Profit / Contribution" value={money(s.net_contribution)} tone={s.net_contribution >= 0 ? 'ok' : 'bad'} />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <Card title="Income">
              <div className="flex justify-between text-sm py-1"><span>Machine job-work revenue</span><span className="font-medium">{money(s.job_work_income)}</span></div>
              <div className="flex justify-between text-sm font-semibold border-t border-ink-200 pt-2 mt-2"><span>Total Income</span><span>{money(s.job_work_income)}</span></div>
            </Card>

            <Card title="Expenses">
              <div className="flex justify-between text-sm py-1"><span>Variable / daily expenses</span><span className="font-medium">{money(s.variable_expenses)}</span></div>
              <div className="flex justify-between text-sm py-1"><span>Fixed / recurring expenses</span><span className="font-medium">{money(s.recurring_expenses)}</span></div>
              <div className="flex justify-between text-sm font-semibold border-t border-ink-200 pt-2 mt-2"><span>Total Expenses</span><span>{money(s.total_expenses)}</span></div>
            </Card>
          </div>

          <Card title="Expense Breakdown by Category" className="mt-5">
            {!breakdownQ.data?.length ? <EmptyState title="No expenses in this period" /> : (
              <div className="overflow-x-auto -mx-4">
                <table className="table-base">
                  <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                  <tbody>
                    {breakdownQ.data.map((r) => (
                      <tr key={r.category_id}><td>{r.category_name}</td><td className="font-medium">{money(r.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Summary" className="mt-5">
            <div className="max-w-sm ml-auto space-y-1 text-sm">
              <div className="flex justify-between"><span>Total Income</span><span>{money(s.job_work_income)}</span></div>
              <div className="flex justify-between"><span>Total Expenses</span><span>({money(s.total_expenses)})</span></div>
              <div className="flex justify-between font-semibold text-base border-t border-ink-200 pt-2">
                <span>Net Profit / Net Contribution</span><span className={s.net_contribution >= 0 ? 'text-ok' : 'text-bad'}>{money(s.net_contribution)}</span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
