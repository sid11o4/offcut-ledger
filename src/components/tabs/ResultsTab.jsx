import { useMemo, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { buildOriginDiagrams, buildScheduleGroups } from '../../lib/matching';
import { downloadCSV } from '../../lib/csv';
import { generateCuttingDiagramsPDF, generateSchedulePDF } from '../../lib/pdf';
import ConfirmGate from '../ConfirmGate';
import NestSVG from '../NestSVG';
import OriginDiagramSVG from '../OriginDiagramSVG';

const MM2_PER_SQFT = 92903.04;

export default function ResultsTab() {
  const { state, toast, applyToInventory, saveProject } = useApp();
  const [projectName, setProjectName] = useState(
    () => `${(state.cutlistFileName || 'Untitled').replace(/\.csv$/i, '')} — ${new Date().toLocaleDateString()}`
  );

  const errors = state.verification.filter((v) => v.level === 'error');
  const warnings = state.verification.filter((v) => v.level === 'warning');

  const originGroups = useMemo(() => {
    const g = {};
    state.matched.forEach((m) => { (g[m._origin_id] = g[m._origin_id] || []).push(m['PANEL_CODE']); });
    return g;
  }, [state.matched]);

  const sharedOriginCount = Object.values(originGroups).filter((g) => g.length > 1).length;

  const { offcutSqFt, panelSqFt, utilizationPct } = useMemo(() => {
    const seenOrigins = new Set();
    let offcutAreaMM2 = 0;
    state.matched.forEach((m) => {
      if (seenOrigins.has(m._origin_id)) return;
      seenOrigins.add(m._origin_id);
      offcutAreaMM2 += m._origin_area_mm2 || 0;
    });
    const panelAreaMM2 = state.matched.reduce((s, m) => s + parseFloat(m['CUT_LENGTH']) * parseFloat(m['CUT_WIDTH']), 0);
    return {
      offcutSqFt: offcutAreaMM2 / MM2_PER_SQFT,
      panelSqFt: panelAreaMM2 / MM2_PER_SQFT,
      utilizationPct: offcutAreaMM2 > 0 ? (panelAreaMM2 / offcutAreaMM2 * 100) : 0,
    };
  }, [state.matched]);

  const discardedCount = (state.discardedOffcuts || []).reduce((s, o) => s + o.qty, 0);
  const discardedSqFt = (state.discardedOffcuts || []).reduce((s, o) => s + o.qty * o.length * o.width, 0) / MM2_PER_SQFT;
  const remainingQty = state.remaining.reduce((s, r) => s + (parseInt(r['ITEM-QTY']) || 1), 0);

  const groupsArr = useMemo(() => (state.matched.length ? buildScheduleGroups(state.matched) : []), [state.matched]);
  const diagrams = useMemo(() => (state.matched.length ? buildOriginDiagrams(state.matched, state.originTrimRects) : []), [state.matched, state.originTrimRects]);

  if (!state.hasRun) {
    return (
      <div>
        <h1 className="page">Results</h1>
        <p className="sub">Nothing to show yet — upload a cutlist and run matching first.</p>
      </div>
    );
  }

  const total = state.matched.length + remainingQty;

  const downloadSchedule = () => {
    const rows = [];
    groupsArr.forEach((g) => {
      g.rows.forEach((r) => {
        rows.push({
          'Offcut Group': g.label,
          'Cut Sequence': r._cut_sequence,
          'Panel Code': r['PANEL_CODE'],
          'Project': r['PROJECT_NAME'],
          'Room': r['ROOM'],
          'Cabinet': r['CABINET_NAME'],
          'Part Name': r['PART_NAME'],
          'Material Used': r._offcut_material,
          'Substituted': r._substituted ? 'Yes' : 'No',
          'Cut Size (mm)': `${r['CUT_LENGTH']} x ${r['CUT_WIDTH']}`,
          'Orientation': r._orientation,
          'Offcut Piece Used (mm)': r._offcut_size,
          'Bin': r._offcut_bin,
        });
      });
    });
    downloadCSV(rows, Object.keys(rows[0]), `Offcut_Cutting_Schedule_${Date.now()}.csv`);
  };

  const downloadSchedulePDF = () => {
    try { generateSchedulePDF(groupsArr, { cutlistFileName: state.cutlistFileName, kerf: state.kerf }); toast('Downloading cutting schedule PDF'); }
    catch (err) { console.error(err); toast('Could not generate schedule PDF: ' + err.message); }
  };

  const downloadDiagramsPDF = () => {
    try {
      generateCuttingDiagramsPDF(diagrams, { cutlistFileName: state.cutlistFileName, matchedCount: state.matched.length, kerf: state.kerf });
      toast(`Downloading ${diagrams.length} cutting diagram${diagrams.length > 1 ? 's' : ''}`);
    } catch (err) { console.error(err); toast('Could not generate cutting diagrams: ' + err.message); }
  };

  const downloadRemainingCSV = () => {
    downloadCSV(state.remaining, state.cutlistFields, `${state.cutlistFileName.replace('.csv', '')}_remaining.csv`);
  };

  return (
    <div>
      <h1 className="page">Results</h1>

      {errors.length > 0 ? (
        <div className="card" style={{ borderColor: 'var(--rust)', background: '#FBECEA' }}>
          <h2 style={{ color: 'var(--rust)' }}>⚠ {errors.length} verification error{errors.length > 1 ? 's' : ''} found — do not apply or cut from these results</h2>
          <p style={{ fontSize: 13, margin: '0 0 10px 0', lineHeight: 1.5 }}>These results were independently re-checked against the raw numbers and failed. Applying to inventory is disabled until this is resolved.</p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--rust)' }}>
            {errors.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e.message}</li>)}
          </ul>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'var(--sage)', background: '#F3F7F3', padding: '14px 22px' }}>
          <span style={{ color: 'var(--sage)', fontWeight: 600, fontSize: 13 }}>
            ✓ {state.verification.length ? `${state.verification.length} automated checks passed with warnings noted below` : 'All automated checks passed'} — panel fit, material rules, quantities, and offcut area all re-verified against raw data.
          </span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--copper)', background: '#FBF5EA' }}>
          <h2 style={{ color: 'var(--copper)' }}>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--copper)' }}>
            {warnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w.message}</li>)}
          </ul>
        </div>
      )}

      {state.historicalView ? (
        <>
          <p className="sub">{state.cutlistFileName} — {total} panel-units. Viewing a saved project from history.</p>
          <div className="card" style={{ borderColor: 'var(--sage)', background: '#F3F7F3' }}>
            <h2 style={{ color: 'var(--sage)' }}>Viewing saved project: {state.viewingProjectName || ''}</h2>
            <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>This is a historical record. Labels and the cutting schedule below regenerate from the data saved at the time — inventory itself reflects the current live stock, shared across all projects.</p>
          </div>
        </>
      ) : (
        <>
          <p className="sub">{state.cutlistFileName} — {total} panel-units checked. {state.applied ? 'These changes have been applied to inventory.' : 'This is a preview — your inventory has not changed yet.'}</p>

          {!state.applied && !errors.length && (
            <div className="card" style={{ borderColor: 'var(--copper)', background: '#FBF5EA' }}>
              <h2 style={{ color: 'var(--copper)' }}>Preview only</h2>
              <p style={{ fontSize: 13, margin: '0 0 12px 0', lineHeight: 1.5 }}>Consumed offcuts and new remnants shown below have <strong>not</strong> been saved yet. Review the matches, then apply to update your stock.</p>
              <ConfirmGate label={`I have reviewed all <strong>${state.matched.length}</strong> matched panels and <strong>${remainingQty}</strong> full-sheet panels below and confirm this is correct before it changes live inventory.`}>
                {(checked) => <button className="btn copper" disabled={!checked} onClick={applyToInventory}>Apply to inventory</button>}
              </ConfirmGate>
            </div>
          )}
          {!state.applied && errors.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--rust)' }}>
              <p style={{ fontSize: 13, margin: 0, color: 'var(--rust)' }}>Applying to inventory is disabled while verification errors exist. Fix the underlying data (or re-run matching) and confirm the errors above are resolved first.</p>
            </div>
          )}

          <div className="card">
            <h2>Save to project history</h2>
            <div className="row">
              <div className="field">
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} style={{ minWidth: 340 }} />
              </div>
              <button className="btn copper" onClick={() => saveProject(projectName.trim() || 'Untitled project')}>Save project</button>
            </div>
            <div className="hint">Stores this cutlist&apos;s matched panels, remaining panels, and settings — so you can revisit results, reprint labels, or re-download the cutting schedule anytime from the Projects tab.</div>
          </div>
        </>
      )}

      <div className="stat">
        <div className="box copper"><div className="n">{state.matched.length}</div><div className="l">Matched from offcuts</div></div>
        <div className="box sage"><div className="n">{sharedOriginCount}</div><div className="l">Offcuts reused for 2+ panels</div></div>
        <div className="box rust"><div className="n">{remainingQty}</div><div className="l">Need full sheet</div></div>
        <div className="box sage">
          <div className="n">{(state.historicalView ? state.inventory : state.pendingInventory).reduce((s, o) => s + o.qty, 0)}</div>
          <div className="l">{state.historicalView ? 'Current live inventory (offcuts)' : `Offcuts remaining ${state.applied ? 'in stock' : '(if applied)'}`}</div>
        </div>
        <div className="box copper"><div className="n">{offcutSqFt.toFixed(1)}</div><div className="l">Sq.ft of offcuts used</div></div>
        <div className="box sage"><div className="n">{utilizationPct.toFixed(0)}%</div><div className="l">Utilization ({panelSqFt.toFixed(1)} sq.ft panels / {offcutSqFt.toFixed(1)} sq.ft offcuts)</div></div>
        <div className="box rust"><div className="n">{discardedCount}</div><div className="l">Scrap discarded ({discardedSqFt.toFixed(1)} sq.ft, unusable after this run)</div></div>
      </div>

      {!state.historicalView && discardedCount > 0 && (
        <div className="card">
          <h2>Scrap discarded this run ({discardedCount} piece{discardedCount > 1 ? 's' : ''})</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
            These pieces were tried against every panel in this cutlist and couldn&apos;t fulfil any of them, and they fall below the keep-threshold for their material — so they won&apos;t be carried forward if you apply this run. This includes untouched original stock that sat unused the whole run, not just fresh cut leftovers.
          </p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Material</th><th>Leftover Size</th><th>Bin</th><th>Qty</th><th>Source</th></tr></thead>
              <tbody>
                {state.discardedOffcuts.map((o) => (
                  <tr key={o.id}>
                    <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>{o.material}</td>
                    <td>{o.length} x {o.width}</td>
                    <td>{o.bin}</td>
                    <td>{o.qty}</td>
                    <td>{o.source || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Panels fulfilled by offcuts ({state.matched.length})</h2>
        {!state.matched.length ? (
          <div className="empty">No panels could be matched to existing stock.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th>Panel</th><th>Cabinet</th><th>Part</th><th>Cut Size</th><th>Material Used</th><th>Matched Offcut</th><th>Bin</th><th>Orientation</th><th>Shared Offcut</th><th>Diagram</th>
              </tr></thead>
              <tbody>
                {state.matched.map((r, i) => {
                  const cutL = parseFloat(r['CUT_LENGTH']), cutW = parseFloat(r['CUT_WIDTH']);
                  const [oL, oW] = r._offcut_size.split(' x ').map(Number);
                  const rotated = r._orientation.startsWith('Rotated');
                  const usedL = rotated ? cutW : cutL, usedW = rotated ? cutL : cutW;
                  const siblings = originGroups[r._origin_id].filter((p) => p !== r['PANEL_CODE']);
                  return (
                    <tr key={i}>
                      <td>{r['PANEL_CODE'] || ''}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 160 }}>{r['CABINET_NAME'] || ''}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 160 }}>{r['PART_NAME'] || ''}</td>
                      <td>{cutL} x {cutW}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 200 }}>
                        {r._substituted
                          ? <span className="pill rot" style={{ whiteSpace: 'normal' }} title={`Needed: ${r['MATERIAL']}`}>Substituted: {r._offcut_material}</span>
                          : <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Exact match</span>}
                      </td>
                      <td>{r._offcut_size}</td>
                      <td>{r._offcut_bin}</td>
                      <td>{rotated ? <span className="pill rot">Rotated</span> : 'As-is'}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>
                        {siblings.length
                          ? <span className="pill match" title={`From the same physical offcut: ${r._origin_label}`}>🔗 with {siblings.slice(0, 3).join(', ')}{siblings.length > 3 ? ` +${siblings.length - 3}` : ''}</span>
                          : <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>Sole use</span>}
                      </td>
                      <td className="diagram-cell"><NestSVG length={oL} width={oW} usedL={usedL} usedW={usedW} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {state.matched.length > 0 && (
        <div className="card">
          <h2>Offcut cutting schedule</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
            Grouped by physical offcut. Groups with 2+ panels show the continuous sequence of cuts to make on that one piece of stock.
          </p>
          <div>
            {groupsArr.map((g) => {
              const multi = g.rows.length > 1;
              return (
                <div key={g.originId} style={{ marginBottom: 16, padding: '12px 14px', border: '1px solid var(--line)', borderLeft: multi ? '3px solid var(--copper)' : undefined }}>
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
                    {multi ? `🔗 CONTINUOUS SEQUENCE — ${g.rows.length} panels from one offcut` : 'Single cut'} &nbsp;·&nbsp; {g.label} &nbsp;·&nbsp; {g.material}
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5 }}>
                    {g.rows.map((r, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <strong>{r['PANEL_CODE'] || ''}</strong> — {r['CUT_LENGTH']} x {r['CUT_WIDTH']} mm ({r._orientation}) — from offcut piece {r._offcut_size} mm
                        {r._substituted ? <span className="pill rot"> substituted</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
          <ConfirmGate label="I have reviewed the sequence above — including any offcuts shared across multiple panels and any substituted materials — and confirm it's correct before this goes to the cutting station.">
            {(checked) => (
              <div style={{ marginTop: 4, display: 'flex', gap: 10 }}>
                <button className="btn copper" disabled={!checked} onClick={downloadSchedulePDF}>Download cutting schedule (PDF)</button>
                <button className="btn secondary" disabled={!checked} onClick={downloadSchedule}>Download cutting schedule (CSV)</button>
              </div>
            )}
          </ConfirmGate>
        </div>
      )}

      {state.matched.length > 0 && diagrams.length > 0 && (
        <div className="card">
          <h2>Cutting diagrams</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
            To-scale layout of every panel on each offcut that got cut this run — same idea as a full-sheet nesting plan, just for your offcuts. Numbered badges show cut order; dashed outlines are the trim left on the board.
          </p>
          <button className="btn copper" onClick={downloadDiagramsPDF}>Download all cutting diagrams (PDF)</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
            {diagrams.map((d) => (
              <div key={d.originId} style={{ border: '1px solid var(--line)', padding: 10, width: 300 }}>
                <div style={{ fontFamily: "'Courier New',monospace", fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>
                  Layout {d.layoutLabel} &nbsp;·&nbsp; {d.originLength} x {d.originWidth} mm &nbsp;·&nbsp; Bin {d.bin}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 8, whiteSpace: 'normal' }}>{d.material}</div>
                <div style={{ border: '1px solid var(--line)', background: '#fff' }}><OriginDiagramSVG d={d} boxW={278} boxH={200} /></div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 6 }}>{d.panels.length} panel{d.panels.length > 1 ? 's' : ''} cut from this piece</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Panels needing a full sheet ({remainingQty})</h2>
        {!state.remaining.length ? (
          <div className="empty">Every panel was fulfilled from stock offcuts.</div>
        ) : (
          <>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Panel</th><th>Material</th><th>Cut Size</th><th>Qty</th></tr></thead>
                <tbody>
                  {state.remaining.map((r, i) => (
                    <tr key={i}>
                      <td>{r['PANEL_CODE'] || ''}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 280 }}>{r['MATERIAL'] || ''}</td>
                      <td>{r['CUT_LENGTH']} x {r['CUT_WIDTH']}</td>
                      <td>{r['ITEM-QTY']}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ConfirmGate label={`I have reviewed the ${remainingQty} panel(s) above and confirm they genuinely need a full sheet before sending this to the nesting software.`}>
              {(checked) => <div style={{ marginTop: 12 }}><button className="btn copper" disabled={!checked} onClick={downloadRemainingCSV}>Download updated cutlist CSV (for full-sheet software)</button></div>}
            </ConfirmGate>
          </>
        )}
      </div>
    </div>
  );
}
