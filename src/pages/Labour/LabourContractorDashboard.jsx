import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import { loadContractor, summarize, presetBounds, projectNameOf } from '../../lib/labourData'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

const PRESETS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']]
const GROUPS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]

// The dashboard for one contractor or mason: projects, payments by day, week or month, the full
// payment history, and what the CEO needs to judge the labour.
export default function LabourContractorDashboard() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const [preset, setPreset] = useState('month')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [groupBy, setGroupBy] = useState('week')

  const q = useQuery({ queryKey: ['labour_contractor', id], queryFn: () => loadContractor(id) })

  const [start, end] = preset === 'custom' ? [custom.start, custom.end] : presetBounds(preset)
  const summary = useMemo(
    () => (q.data ? summarize(q.data.entries, { start, end, groupBy }) : null),
    [q.data, start, end, groupBy],
  )

  async function voidEntry(entry) {
    const reason = window.prompt(`Void the ${money(entry.amount)} labour entry from ${displayDate(entry.entry_date)}? Give a reason:`)
    if (!reason) return
    const { error } = await supabase.rpc('void_labour_entry', { p_entry_id: entry.id, p_reason: reason })
    if (error) return toast.error(error.message)
    toast.success('Labour entry voided.')
    qc.invalidateQueries({ queryKey: ['labour_contractor', id] })
    qc.invalidateQueries({ queryKey: ['labour_contractors'] })
  }

  if (q.isLoading) return <LoadingBlock />
  if (q.error) return <EmptyState title="Could not load this contractor" hint={q.error.message} />
  const c = q.data.contractor

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={`${c.role}${c.phone ? ` · ${c.phone}` : ''}${c.notes ? ` · ${c.notes}` : ''}`}
        actions={<Link className="btn-secondary" to="/labour">All contractors</Link>}
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([k, label]) => (
            <button key={k} className={preset === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setPreset(k)}>{label}</button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" className="field-input w-auto" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
              <span className="text-sm text-ink-500">to</span>
              <input type="date" className="field-input w-auto" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-ink-500 mr-1">Group by</span>
            {GROUPS.map(([k, label]) => (
              <button key={k} className={groupBy === k ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setGroupBy(k)}>{label}</button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        <StatCard label="Total paid" value={money(summary.total)} money />
        <StatCard label="Shifts" value={qty(summary.shifts)} />
        <StatCard label="Average per shift" value={money(summary.avgPerShift)} money />
        <StatCard label="Days worked" value={summary.days} />
        <StatCard label="Projects" value={summary.projectCount} />
        <StatCard label="Shifts per week" value={qty(summary.avgShiftsPerWeek)} />
        <StatCard label="Last shift" value={summary.lastDate ? displayDate(summary.lastDate) : '—'} />
      </div>

      <Card title={`Payments by ${groupBy}`} className="mb-5">
        {!summary.byPeriod.length ? <EmptyState title="No payments in this period" /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.byPeriod} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => money(v)} width={90} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="amount" fill="#334155" name="Paid" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 mb-5">
        <Card title="By project">
          {!summary.byProject.length ? <EmptyState title="No projects in this period" /> : (
            <table className="table-base">
              <thead><tr><th>Project</th><th className="num">Days</th><th className="num">Shifts</th><th className="num">Paid</th><th className="num">Share</th></tr></thead>
              <tbody>
                {summary.byProject.map((p) => (
                  <tr key={p.name}>
                    <td className="font-medium">{p.name}</td>
                    <td className="num">{p.days}</td>
                    <td className="num">{qty(p.shifts)}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td className="num">{(p.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={`Payments by ${groupBy}`}>
          {!summary.byPeriod.length ? <EmptyState title="No payments in this period" /> : (
            <table className="table-base">
              <thead><tr><th>Period</th><th className="num">Shifts</th><th className="num">Paid</th></tr></thead>
              <tbody>
                {[...summary.byPeriod].reverse().map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className="num">{qty(p.shifts)}</td>
                    <td className="num">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title={`Payment history (${summary.inRange.length})`}>
        {!summary.inRange.length ? <EmptyState title="No labour entries in this period" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Project</th><th className="num">Shifts</th><th className="num">Per shift</th><th className="num">Total</th><th>Notes</th><th>Status</th><th /></tr></thead>
              <tbody>
                {summary.inRange.map((e) => (
                  <tr key={e.id} className={e.status === 'void' ? 'text-ink-400 line-through' : ''}>
                    <td>{displayDate(e.entry_date)}</td>
                    <td>{projectNameOf(e)}</td>
                    <td className="num">{qty(e.shifts)}</td>
                    <td className="num">{money(e.rate_per_shift)}</td>
                    <td className="num">{money(e.amount)}</td>
                    <td>{e.notes || '—'}</td>
                    <td className="capitalize">{e.status === 'void' ? `Void: ${e.void_reason || ''}` : 'Paid'}</td>
                    <td className="text-right no-underline">
                      {e.status === 'active' && <button className="btn-ghost text-xs px-2" onClick={() => voidEntry(e)}>Void</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
