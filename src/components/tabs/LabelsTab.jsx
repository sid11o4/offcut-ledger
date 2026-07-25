import { useApp } from '../../state/AppContext';
import { printLabels as printLabelsPDF, generateWrapLabelsPDF } from '../../lib/pdf';

export default function LabelsTab() {
  const { state, toast } = useApp();

  const printLabels = () => {
    try { printLabelsPDF(state.matched); toast(`Downloading ${state.matched.length} labels`); }
    catch (err) { console.error(err); toast('Could not generate labels: ' + err.message); }
  };

  const printRemnantLabels = () => {
    try { generateWrapLabelsPDF(state.newRemnants, 'Offcut_Remnant_Wrap_Labels'); toast(`Downloading ${state.newRemnants.length} wrap label${state.newRemnants.length > 1 ? 's' : ''}`); }
    catch (err) { console.error(err); toast('Could not generate wrap labels: ' + err.message); }
  };

  return (
    <div>
      <h1 className="page">Labels</h1>
      <p className="sub">Print 75mm × 100mm labels for every panel that was fulfilled by an offcut — panel code, project, room, cabinet and both finish/cut sizes, plus which offcut and bin it came from.</p>

      <div className="card">
        <h2>Ready to print: {state.matched.length} labels</h2>
        {!state.matched.length ? (
          <div className="empty">Run a matching pass in &quot;Match Cutlist&quot; first — labels are generated for offcut-fulfilled panels only.</div>
        ) : (
          <>
            <button className="btn copper" onClick={printLabels}>Download label PDF ({state.matched.length} pages)</button>
            <div className="hint">Sample of what&apos;s included: {state.matched.slice(0, 3).map((m) => m['PANEL_CODE']).join(', ')}{state.matched.length > 3 ? '…' : ''}</div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Leftover offcut wrap labels: {state.newRemnants.length}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
          75mm × 100mm label split into 3 identical bands — wraps over the top face, across the edge, and onto the bottom face, so the leftover&apos;s material and size stay legible from any side in a stack. Generated only for remnants actually produced by the last matching run — untouched stock never gets one.
        </p>
        {!state.newRemnants.length ? (
          <div className="empty">
            {state.historicalView
              ? 'No leftover offcuts recorded for this project — either the run genuinely produced none, or (if this was saved before wrap labels existed) it just wasn\'t tracked at the time.'
              : 'Run a matching pass in "Match Cutlist" first — wrap labels are generated only for the leftover pieces created by that run.'}
          </div>
        ) : (
          <>
            <button className="btn copper" onClick={printRemnantLabels}>Download wrap label PDF ({state.newRemnants.length} pages)</button>
            <div className="hint">Sample: {state.newRemnants.slice(0, 3).map((r) => `${r.length}x${r.width} (Bin ${r.bin})`).join(', ')}{state.newRemnants.length > 3 ? '…' : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}
