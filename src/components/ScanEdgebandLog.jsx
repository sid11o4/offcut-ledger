import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Card, Badge, LoadingBlock } from './ui'

// Lets the operator's paper "PVC Edgebanding Usage Log" sheet be photographed instead of
// re-typed. Extraction (the extract-edgeband-scan Edge Function, using Claude's vision) reads
// ONLY Project, Edgeband Thickness and Total Meters per row -- nothing else on the sheet is
// captured. Every row still lands here as an editable, unconfirmed suggestion: "Log Entry"
// calls the exact same record_job_work_entry() RPC the manual Daily Log form uses, so the
// calculation engine, rates and billing are never touched by the scan itself.
export default function ScanEdgebandLog({ date, projects, services, units, profile, toast, onSaved }) {
  const [scanDate, setScanDate] = useState(date)
  const [phase, setPhase] = useState('idle') // idle | working | review
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  const edgebandServices = services.filter((s) => !s.is_composite && s.active && /edgeband/i.test(s.name))
  const serviceOptions = edgebandServices.length ? edgebandServices : services.filter((s) => !s.is_composite && s.active)
  const meterUnit = units.find((u) => u.code === 'MTR')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setPhase('working')
    try {
      const path = `${profile.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('scan-uploads').upload(path, file)
      if (upErr) throw upErr

      const { data: batch, error: batchErr } = await supabase
        .from('scanned_edgeband_batches')
        .insert({ image_path: path, entry_date: scanDate, created_by: profile.id })
        .select().single()
      if (batchErr) throw batchErr

      const { data: fnResult, error: fnErr } = await supabase.functions.invoke('extract-edgeband-scan', { body: { batch_id: batch.id } })
      if (fnErr) throw new Error(fnResult?.error || fnErr.message)
      if (fnResult?.error) throw new Error(fnResult.error)

      const { data: extractedRows, error: rowsErr } = await supabase
        .from('scanned_edgeband_rows').select('*').eq('batch_id', batch.id).order('row_no')
      if (rowsErr) throw rowsErr

      setRows((extractedRows || []).map((r) => ({ ...r, localStatus: r.status })))
      setPhase('review')
      if (!extractedRows?.length) toast.info('No rows were found on that photo — try a clearer, well-lit shot.')
    } catch (err) {
      setError(err.message || String(err))
      setPhase('idle')
    }
  }

  function updateRow(id, patch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function logEntry(row) {
    if (!row.project_id) return toast.error('Select the project for this row.')
    if (!row.service_id) return toast.error('Select the edgeband thickness for this row.')
    if (!row.total_meters || Number(row.total_meters) <= 0) return toast.error('Enter the total meters for this row.')
    if (!meterUnit) return toast.error('No "Meter" unit found — ask an admin to check Masters > Units.')

    updateRow(row.id, { saving: true })
    const { data: entryId, error: rpcErr } = await supabase.rpc('record_job_work_entry', {
      p_entry_date: scanDate, p_project_id: row.project_id, p_service_id: row.service_id,
      p_base_quantity: Number(row.total_meters), p_remarks: `Scanned from paper edgeband log (row ${row.row_no}).`,
      p_rate_overrides: null, p_unit_id: meterUnit.id,
    })
    if (rpcErr) {
      updateRow(row.id, { saving: false })
      return toast.error(rpcErr.message)
    }
    await supabase.from('scanned_edgeband_rows').update({
      status: 'confirmed', entry_id: entryId, project_id: row.project_id, service_id: row.service_id, total_meters: row.total_meters,
    }).eq('id', row.id)
    updateRow(row.id, { saving: false, localStatus: 'confirmed' })
    toast.success(`Row ${row.row_no} logged.`)
    onSaved()
    maybeFinishBatch(row.batch_id)
  }

  async function skipRow(row) {
    await supabase.from('scanned_edgeband_rows').update({ status: 'skipped' }).eq('id', row.id)
    updateRow(row.id, { localStatus: 'skipped' })
    maybeFinishBatch(row.batch_id)
  }

  async function maybeFinishBatch(batchId) {
    setRows((rs) => {
      const stillPending = rs.some((r) => r.batch_id === batchId && r.localStatus === 'pending')
      if (!stillPending) {
        supabase.from('scanned_edgeband_batches')
          .update({ status: 'reviewed', reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
          .eq('id', batchId)
      }
      return rs
    })
  }

  function startOver() {
    setRows([])
    setPhase('idle')
    setError('')
  }

  const pendingCount = rows.filter((r) => r.localStatus === 'pending').length

  return (
    <Card title="Scan Edgeband Log">
      <p className="text-xs text-ink-500 mb-3">
        Photograph the filled-in paper log. Claude reads the Project, Edgeband Thickness and Total Meters for each row —
        you confirm or correct every row below before anything is logged.
      </p>

      {phase !== 'review' && (
        <div className="space-y-3">
          <div>
            <label className="field-label">Date on the sheet</label>
            <input className="field-input max-w-xs" type="date" value={scanDate} onChange={(e) => setScanDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Photo</label>
            <input className="field-input" type="file" accept="image/*" capture="environment" disabled={phase === 'working'} onChange={handleFile} />
          </div>
          {phase === 'working' && <LoadingBlock label="Reading the sheet…" />}
          {error && <div className="text-sm text-bad bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}
        </div>
      )}

      {phase === 'review' && (
        <div className="space-y-3">
          {!rows.length ? (
            <div className="text-sm text-ink-500">No rows were found on that photo.</div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="border border-ink-200 rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-ink-500">Row {row.row_no}</span>
                  {row.localStatus === 'confirmed' && <Badge tone="ok">Logged</Badge>}
                  {row.localStatus === 'skipped' && <Badge tone="neutral">Skipped</Badge>}
                </div>
                {row.localStatus === 'pending' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="field-label">Project{row.project_text && <span className="text-ink-400 font-normal"> — read "{row.project_text}"</span>}</label>
                        <select className="field-input" value={row.project_id || ''} onChange={(e) => updateRow(row.id, { project_id: e.target.value })}>
                          <option value="">Select…</option>
                          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="field-label">Edgeband Thickness{row.edgeband_text && <span className="text-ink-400 font-normal"> — read "{row.edgeband_text}"</span>}</label>
                        <select className="field-input" value={row.service_id || ''} onChange={(e) => updateRow(row.id, { service_id: e.target.value })}>
                          <option value="">Select…</option>
                          {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="field-label">Total Meters</label>
                        <input className="field-input w-32" type="number" min="0" step="0.01" value={row.total_meters ?? ''} onChange={(e) => updateRow(row.id, { total_meters: e.target.value })} />
                      </div>
                      <button type="button" className="btn-primary" disabled={row.saving} onClick={() => logEntry(row)}>{row.saving ? 'Logging…' : 'Log Entry'}</button>
                      <button type="button" className="btn-ghost" disabled={row.saving} onClick={() => skipRow(row)}>Skip</button>
                    </div>
                    {row.flag && <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠ {row.flag}</div>}
                  </>
                ) : (
                  <div className="text-xs text-ink-500">
                    {row.project_text || '—'} · {row.edgeband_text || '—'} · {row.total_meters ?? '—'} m
                  </div>
                )}
              </div>
            ))
          )}
          <div className="flex justify-between items-center pt-1">
            <span className="text-xs text-ink-500">{pendingCount} row{pendingCount === 1 ? '' : 's'} left to review</span>
            <button type="button" className="btn-secondary" onClick={startOver}>Scan Another Sheet</button>
          </div>
        </div>
      )}
    </Card>
  )
}
