import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { Card } from './ui'
import { displayDate } from '../lib/dates'

// Read-only view of how far the project is on site, from FORMGRID Track (track.formgrid.in).
// Factory only ever calls a SELECT-only function: Track data cannot be changed from here.
export default function TrackProgressCard({ projectId }) {
  const q = useQuery({
    queryKey: ['track_progress', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('track_progress_for_design_project', { p_design_project: projectId })
      if (error) throw error
      return data
    },
    retry: false,
  })

  // Not linked to a Track project, or Track is not set up yet: show nothing rather than an error.
  if (q.isLoading || q.error || !q.data) return null
  const d = q.data
  const pct = Math.round((d.overall_pct || 0) * 100)
  return (
    <Card title="Site progress" actions={<a className="text-xs text-brand-700 underline" href="https://track.formgrid.in" target="_blank" rel="noreferrer">Open in Track</a>} className="mb-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div className="text-4xl font-semibold tnum text-ink-950">{pct}%</div>
        <p className="text-xs text-ink-500 pb-1">
          {d.last_report_date ? `Last site report ${displayDate(d.last_report_date)}` : 'No site report yet'}
          {d.open_material_requests > 0 ? ` · ${d.open_material_requests} open material request${d.open_material_requests === 1 ? '' : 's'}` : ''}
        </p>
      </div>
      <div className="h-2 rounded bg-ink-100 mt-3 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
      {d.rooms?.length > 0 && (
        <table className="table-base mt-4">
          <thead><tr><th>Room</th><th className="num">Done</th></tr></thead>
          <tbody>
            {d.rooms.map((r) => <tr key={r.room}><td>{r.room}</td><td className="num tnum">{Math.round((r.pct || 0) * 100)}%</td></tr>)}
          </tbody>
        </table>
      )}
    </Card>
  )
}
