import { useMemo, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { downloadCSV, downloadCustomOffcutsTemplate, inventoryToCSVRows, parseGenericCSV, parseInventoryFile, rowsToLabelList } from '../../lib/csv';
import { generateWrapLabelsPDF } from '../../lib/pdf';

const emptyForm = { material: '', length: '', width: '', bin: 'A', qty: '1' };

export default function InventoryTab() {
  const { state, toast, addInventoryEntry, deleteInventoryEntry, clearAllInventory, importInventoryRows } = useApp();
  const [form, setForm] = useState(emptyForm);
  const [customForm, setCustomForm] = useState(emptyForm);
  const [clearConfirm, setClearConfirm] = useState(false);

  const materialOptions = useMemo(() => [...new Set(state.inventory.map((o) => o.material))], [state.inventory]);

  const submitAdd = async () => {
    const material = form.material.trim();
    const length = parseFloat(form.length);
    const width = parseFloat(form.width);
    const bin = form.bin.trim() || 'A';
    const qty = parseInt(form.qty, 10) || 1;
    if (!material || !length || !width) { toast('Fill material, length and width'); return; }
    await addInventoryEntry({ material, length, width, bin, qty });
    toast('Added to stock');
    setForm(emptyForm);
  };

  const handleInvFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { rows, sourceLabel } = await parseInventoryFile(file);
      await importInventoryRows(rows, sourceLabel);
    } catch (err) {
      console.error(err);
      toast(file.name.toLowerCase().match(/\.xlsx?$/) ? 'Could not read that Excel file' : 'Could not read that CSV file');
    }
  };

  const readCustomForm = () => {
    const material = customForm.material.trim();
    const length = parseFloat(customForm.length);
    const width = parseFloat(customForm.width);
    const bin = customForm.bin.trim() || 'A';
    const qty = parseInt(customForm.qty, 10) || 1;
    if (!material || !length || !width) { toast('Fill material, length and width'); return null; }
    return { material, length, width, bin, qty };
  };

  const customAdd = async () => {
    const f = readCustomForm();
    if (!f) return;
    await addInventoryEntry(f);
    toast(`Added ${f.qty} to stock`);
    setCustomForm(emptyForm);
  };

  const customPrint = () => {
    const f = readCustomForm();
    if (!f) return;
    const labelList = Array.from({ length: f.qty }, () => ({
      material: f.material, length: f.length, width: f.width, bin: f.bin,
      _origin_label: `${f.length} x ${f.width} (Bin ${f.bin})`,
      _from_panel: '', _from_project: '', _from_room: '', _from_cabinet: '', _from_part: '',
    }));
    try {
      generateWrapLabelsPDF(labelList, 'Custom_Offcut_Wrap_Labels');
      toast(`Downloading ${labelList.length} wrap label${labelList.length > 1 ? 's' : ''}`);
    } catch (err) { toast(err.message); }
  };

  const customCsvAdd = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = await parseGenericCSV(file);
      await importInventoryRows(rows, file.name);
    } catch (err) { console.error(err); toast('Could not read that CSV file'); }
  };

  const customCsvPrint = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = await parseGenericCSV(file);
      const { labelList, skipped } = rowsToLabelList(rows);
      generateWrapLabelsPDF(labelList, 'Custom_Offcut_Wrap_Labels_Bulk');
      if (skipped.length) toast(`Skipped ${skipped.length} row(s) with missing/invalid data`);
    } catch (err) { console.error(err); toast(err.message || 'Could not read that CSV file'); }
  };

  const sortedInventory = useMemo(
    () => state.inventory.slice().sort((a, b) => a.material.localeCompare(b.material) || a.length - b.length),
    [state.inventory]
  );

  return (
    <div>
      <h1 className="page">Inventory</h1>
      <p className="sub">Offcut stock, shared across every project. Add pieces manually or import a CSV. Quantities update automatically as cutlists are matched.</p>

      <div className="card">
        <h2>Add offcut</h2>
        <div className="row">
          <div className="field">
            <label>Material</label>
            <input list="mat-list" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="17.0_MR PLY_..." style={{ minWidth: 280 }} />
          </div>
          <datalist id="mat-list">{materialOptions.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="field"><label>Length (mm)</label><input type="number" step="0.1" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} style={{ width: 100 }} /></div>
          <div className="field"><label>Width (mm)</label><input type="number" step="0.1" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} style={{ width: 100 }} /></div>
          <div className="field"><label>Bin</label><input value={form.bin} onChange={(e) => setForm({ ...form, bin: e.target.value })} style={{ width: 70 }} /></div>
          <div className="field"><label>Qty</label><input type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ width: 70 }} /></div>
          <button className="btn copper" onClick={submitAdd}>+ Add to stock</button>
        </div>
        <div className="hint">Or import in bulk — accepts the BOARD template (.xlsx or .csv: ITEM_CODE / LENGTH / WIDTH / BIN / REQD) or the FC:: export format.
          <label className="link" style={{ cursor: 'pointer' }}> Choose file<input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleInvFile} /></label>
        </div>
        {state.lastImportSkips.length > 0 && (
          <div className="hint" style={{ color: 'var(--rust)' }}>
            Skipped {state.lastImportSkips.length} row(s): {state.lastImportSkips.slice(0, 5).join(' · ')}{state.lastImportSkips.length > 5 ? ' …' : ''}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Generate custom offcut piece</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
          For a physical scrap piece already sitting on the shelf that never went through a matching run. Add it to stock, print its wrap label, or both — independently.
        </p>
        <div className="row">
          <div className="field"><label>Material</label><input list="mat-list" value={customForm.material} onChange={(e) => setCustomForm({ ...customForm, material: e.target.value })} placeholder="17.0_MR PLY_..." style={{ minWidth: 280 }} /></div>
          <div className="field"><label>Length (mm)</label><input type="number" step="0.1" value={customForm.length} onChange={(e) => setCustomForm({ ...customForm, length: e.target.value })} style={{ width: 100 }} /></div>
          <div className="field"><label>Width (mm)</label><input type="number" step="0.1" value={customForm.width} onChange={(e) => setCustomForm({ ...customForm, width: e.target.value })} style={{ width: 100 }} /></div>
          <div className="field"><label>Bin</label><input value={customForm.bin} onChange={(e) => setCustomForm({ ...customForm, bin: e.target.value })} style={{ width: 70 }} /></div>
          <div className="field"><label>Qty (pieces)</label><input type="number" min="1" value={customForm.qty} onChange={(e) => setCustomForm({ ...customForm, qty: e.target.value })} style={{ width: 80 }} /></div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn copper" onClick={customAdd}>+ Add to stock</button>
          <button className="btn" onClick={customPrint}>Print wrap labels only</button>
          <span className="hint" style={{ margin: 0 }}>&quot;Print&quot; uses the fields above directly — it doesn&apos;t touch stock, so you can label pieces you&apos;ve already added, or reprint without adding duplicates.</span>
        </div>
        <div className="hint" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          Got several to log at once? Use a CSV instead — same MATERIAL / LENGTH / WIDTH / BIN / QTY columns.
          <label className="link" style={{ cursor: 'pointer' }}> Add CSV to stock<input type="file" accept=".csv" style={{ display: 'none' }} onChange={customCsvAdd} /></label>
          {' · '}<label className="link" style={{ cursor: 'pointer' }}>Print wrap labels from CSV<input type="file" accept=".csv" style={{ display: 'none' }} onChange={customCsvPrint} /></label>
          {' · '}<a href="#" className="link" onClick={(e) => { e.preventDefault(); downloadCustomOffcutsTemplate(); }}>Download blank template</a>
        </div>
      </div>

      <div className="card">
        <h2>Current stock ({state.inventory.length} entries)</h2>
        {!state.inventory.length ? (
          <div className="empty">No offcuts in stock yet. Add one above or import a CSV.</div>
        ) : (
          <>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Material</th><th>Length</th><th>Width</th><th>Bin</th><th>Qty</th><th></th></tr></thead>
                <tbody>
                  {sortedInventory.map((o) => (
                    <tr key={o.id}>
                      <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>{o.material}</td>
                      <td>{o.length}</td><td>{o.width}</td><td>{o.bin}</td><td>{o.qty}</td>
                      <td><button className="icon-del" onClick={() => deleteInventoryEntry(o.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn secondary" onClick={() => downloadCSV(inventoryToCSVRows(state.inventory), ['ITEM_CODE', 'ITEM_NAME', 'BIN', 'LENGTH', 'WIDTH', 'REQD'], 'inventory_export.csv')}>Download inventory CSV</button>
              {!clearConfirm ? (
                <button className="btn secondary" style={{ borderColor: 'var(--rust)', color: 'var(--rust)' }} onClick={() => setClearConfirm(true)}>Clear all inventory</button>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--rust)' }}>Delete all {state.inventory.length} entries?</span>
                  <button className="btn" style={{ background: 'var(--rust)', borderColor: 'var(--rust)' }} onClick={async () => { await clearAllInventory(); setClearConfirm(false); }}>Yes, delete all</button>
                  <button className="btn secondary" onClick={() => setClearConfirm(false)}>Cancel</button>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
