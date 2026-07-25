import { useMemo, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { extractThickness } from '../../lib/matching';
import { parseCutlistCSV } from '../../lib/csv';

export default function CutlistTab() {
  const {
    state, toast, setCutlist, setKerf,
    addUnexposedRule, deleteUnexposedRule, addDiscardRule, deleteDiscardRule, runMatchingAction,
  } = useApp();

  const [unexposedMat, setUnexposedMat] = useState('');
  const [unexposedThick, setUnexposedThick] = useState('');
  const [discardMat, setDiscardMat] = useState('');
  const [discardLen, setDiscardLen] = useState('');
  const [discardWid, setDiscardWid] = useState('');

  const cutlistMaterials = useMemo(() => [...new Set(state.cutlistRows.map((r) => r.MATERIAL).filter(Boolean))], [state.cutlistRows]);

  const handleCutlistFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { rows, fields } = await parseCutlistCSV(file);
      setCutlist(rows, fields, file.name);
      toast(`Loaded ${rows.length} panel rows`);
    } catch (err) { console.error(err); toast('Could not read that CSV file'); }
  };

  const submitUnexposed = async () => {
    const val = unexposedMat.trim();
    const thickRaw = unexposedThick.trim();
    if (!val) { toast('Enter a material name'); return; }
    if (extractThickness(val) === null) { toast('Material must start with a thickness number, e.g. 16.2_...'); return; }
    const thicknesses = thickRaw.split(',').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    if (!thicknesses.length) { toast('Enter at least one substitute thickness, e.g. 17.0, 18.0'); return; }
    if (state.unexposedMaterials.some((u) => u.material.trim().toLowerCase() === val.toLowerCase())) { toast('Already flagged — remove it first to change thicknesses'); return; }
    await addUnexposedRule({ material: val, thicknesses });
    setUnexposedMat(''); setUnexposedThick('');
  };

  const submitDiscard = async () => {
    const material = discardMat.trim();
    const minLength = parseFloat(discardLen);
    const minWidth = parseFloat(discardWid);
    if (!material) { toast('Enter a material name'); return; }
    if (!isFinite(minLength) || !isFinite(minWidth) || minLength <= 0 || minWidth <= 0) { toast('Enter valid min length and width'); return; }
    if (state.discardRules.some((r) => r.material.trim().toLowerCase() === material.toLowerCase())) { toast('A rule already exists for this material — remove it first to change it'); return; }
    await addDiscardRule({ material, minLength, minWidth });
    setDiscardMat(''); setDiscardLen(''); setDiscardWid('');
  };

  return (
    <div>
      <h1 className="page">Match Cutlist</h1>
      <p className="sub">Upload a project cutlist. Each panel is checked against stock offcuts of the same material — rotation allowed, tightest fit wins, leftover remnants ≥100mm return to stock automatically, blade kerf accounted for on every cut. Multiple panels can be nested from the same offcut: leftover remnants feed straight back into the pool for the next panel in the same run.</p>

      <div className="card">
        <h2>Cutlist file</h2>
        <div className="row">
          <label className="btn secondary" style={{ cursor: 'pointer' }}>Choose cutlist CSV<input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCutlistFile} /></label>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{state.cutlistFileName || 'No file loaded'}</span>
        </div>
        {state.cutlistRows.length > 0 && (
          <div className="hint">{state.cutlistRows.length} panel rows loaded across {new Set(state.cutlistRows.map((r) => r.MATERIAL)).size} materials.</div>
        )}
      </div>

      <div className="card">
        <h2>Blade kerf</h2>
        <div className="field"><label>Kerf / blade thickness (mm)</label><input type="number" step="0.5" min="0" value={state.kerf} onChange={(e) => setKerf(parseFloat(e.target.value) || 0)} style={{ width: 100 }} /></div>
        <div className="hint">Every cut that separates a piece from the stock loses this much material. Applied when calculating how much usable offcut remains after each cut — it does not shrink the panel itself.</div>
      </div>

      <div className="card">
        <h2>Unexposed materials (specific substitute thicknesses allowed)</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
          Flag a material as &quot;unexposed&quot; (hidden structural panels, no finish visible) and name which <strong>other thicknesses</strong> are acceptable substitutes — any offcut of that thickness works, regardless of core or finish.
        </p>
        <div className="row">
          <div className="field">
            <label>Material name (exact, as it appears in cutlist)</label>
            <input list="unexposed-mat-list" value={unexposedMat} onChange={(e) => setUnexposedMat(e.target.value)} placeholder="16.2_MR PLY_DEFAULT_MAT_DEFAULT_MAT" style={{ minWidth: 340 }} />
          </div>
          <datalist id="unexposed-mat-list">{cutlistMaterials.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="field">
            <label>Allowed substitute thicknesses (mm, comma-separated)</label>
            <input value={unexposedThick} onChange={(e) => setUnexposedThick(e.target.value)} placeholder="17.0, 18.0" style={{ width: 160 }} />
          </div>
          <button className="btn copper" onClick={submitUnexposed}>+ Add rule</button>
        </div>
        <div className="tablewrap" style={{ marginTop: 14, maxHeight: 200 }}>
          <table>
            <thead><tr><th>Material</th><th>Own Thickness</th><th>Substitutes Allowed</th><th></th></tr></thead>
            <tbody>
              {!state.unexposedMaterials.length ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>None flagged — all materials require an exact match.</td></tr>
              ) : state.unexposedMaterials.map((rule) => {
                const t = extractThickness(rule.material);
                return (
                  <tr key={rule.id}>
                    <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>{rule.material}</td>
                    <td>{t !== null ? t : '—'}</td>
                    <td>{rule.thicknesses.join(', ')} mm</td>
                    <td><button className="icon-del" onClick={() => deleteUnexposedRule(rule.id)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Minimum remnant size per material</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
          When a cut leaves a remnant of this material, keep it only if it clears this size in <strong>either</strong> orientation — otherwise it&apos;s discarded as scrap instead of returned to stock. Overrides the generic 100mm-side floor for this material.
        </p>
        <div className="row">
          <div className="field">
            <label>Material name (exact)</label>
            <input list="discard-mat-list" value={discardMat} onChange={(e) => setDiscardMat(e.target.value)} placeholder="17.0_MR PLY_DEFAULT_MAT_LIGHT BROWN CAMBRIC 6965 SUD" style={{ minWidth: 340 }} />
          </div>
          <datalist id="discard-mat-list">{cutlistMaterials.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="field"><label>Min length (mm)</label><input type="number" value={discardLen} onChange={(e) => setDiscardLen(e.target.value)} style={{ width: 100 }} /></div>
          <div className="field"><label>Min width (mm)</label><input type="number" value={discardWid} onChange={(e) => setDiscardWid(e.target.value)} style={{ width: 100 }} /></div>
          <button className="btn copper" onClick={submitDiscard}>+ Add rule</button>
        </div>
        <div className="tablewrap" style={{ marginTop: 14, maxHeight: 200 }}>
          <table>
            <thead><tr><th>Material</th><th>Min Size (either orientation)</th><th></th></tr></thead>
            <tbody>
              {!state.discardRules.length ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>None set — generic 100mm-side floor applies to all materials.</td></tr>
              ) : state.discardRules.map((rule) => (
                <tr key={rule.id}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 360 }}>{rule.material}</td>
                  <td>{rule.minLength} x {rule.minWidth} mm</td>
                  <td><button className="icon-del" onClick={() => deleteDiscardRule(rule.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Run matching</h2>
        <button className="btn copper" disabled={!state.cutlistRows.length} onClick={runMatchingAction}>Preview match against stock</button>
        <div className="hint">This only previews the result — nothing in your inventory changes until you review it on the Results tab and click &quot;Apply to inventory&quot;.</div>
      </div>
    </div>
  );
}
