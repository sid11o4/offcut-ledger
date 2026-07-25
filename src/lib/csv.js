import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { normMat, uid } from './matching';

export function normHeaderKey(h) {
  return h.replace(/^FC::/i, '').trim().toUpperCase();
}

// Converts parsed CSV/XLSX rows into inventory entries, merging into `inventory` (a plain
// array, mutated in place — same merge-by material+length+width+bin behavior as the original).
export function rowsToInventoryEntries(rows, inventory) {
  const results = { added: 0, merged: 0, skipped: [], entries: [] };
  rows.forEach((raw, idx) => {
    const allBlank = Object.values(raw).every((v) => v === null || v === undefined || String(v).trim() === '');
    if (allBlank) return;
    const map = {};
    Object.keys(raw).forEach((k) => { map[normHeaderKey(k)] = raw[k] == null ? '' : String(raw[k]); });
    const material = (map['ITEM_NAME'] || map['ITEM_CODE'] || map['MATERIAL'] || map['PARENT_ITEM_CODE'] || '').trim();
    const cleanNum = (s) => parseFloat(String(s).replace(/,/g, '').trim());
    const length = cleanNum(map['LENGTH']);
    const width = cleanNum(map['WIDTH']);
    const qtyRaw = map['REQD'] || map['QTY'] || '1';
    const qty = cleanNum(qtyRaw) || 1;
    const bin = (map['BIN'] || map['BOX_NO'] || 'A').trim() || 'A';

    if (!material || !isFinite(length) || !isFinite(width) || length <= 0 || width <= 0) {
      results.skipped.push(`Row ${idx + 2}: ${!material ? 'missing material' : ''} ${(!isFinite(length) || length <= 0) ? 'invalid length' : ''} ${(!isFinite(width) || width <= 0) ? 'invalid width' : ''}`.trim());
      return;
    }
    const existing = inventory.find((o) => normMat(o.material) === normMat(material) && o.length === length && o.width === width && o.bin === bin);
    if (existing) { existing.qty += qty; results.merged++; }
    else { inventory.push({ id: uid(), material, length, width, bin, qty }); results.added++; }
    results.entries.push({ material, length, width, bin, qty });
  });
  return results;
}

export function parseInventoryFile(file) {
  const name = file.name.toLowerCase();
  return new Promise((resolve, reject) => {
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheetName = wb.SheetNames.includes('BOARD') ? 'BOARD' : wb.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
          resolve({ rows, sourceLabel: `sheet "${sheetName}"` });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => resolve({ rows: res.data, sourceLabel: file.name }),
        error: (err) => reject(err),
      });
    }
  });
}

export function parseCutlistCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => resolve({ rows: res.data, fields: res.meta.fields }),
      error: (err) => reject(err),
    });
  });
}

export function parseGenericCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });
}

export function rowsToLabelList(rows) {
  const cleanNum = (s) => parseFloat(String(s).replace(/,/g, '').trim());
  const labelList = [];
  const skipped = [];
  rows.forEach((raw, idx) => {
    const allBlank = Object.values(raw).every((v) => v === null || v === undefined || String(v).trim() === '');
    if (allBlank) return;
    const map = {};
    Object.keys(raw).forEach((k) => { map[normHeaderKey(k)] = raw[k] == null ? '' : String(raw[k]); });
    const material = (map['ITEM_NAME'] || map['ITEM_CODE'] || map['MATERIAL'] || map['PARENT_ITEM_CODE'] || '').trim();
    const length = cleanNum(map['LENGTH']);
    const width = cleanNum(map['WIDTH']);
    const qty = cleanNum(map['REQD'] || map['QTY'] || '1') || 1;
    const bin = (map['BIN'] || map['BOX_NO'] || 'A').trim() || 'A';
    if (!material || !isFinite(length) || !isFinite(width) || length <= 0 || width <= 0) {
      skipped.push(`Row ${idx + 2}`);
      return;
    }
    for (let i = 0; i < qty; i++) {
      labelList.push({
        material, length, width, bin,
        _origin_label: `${length} x ${width} (Bin ${bin})`,
        _from_panel: '', _from_project: '', _from_room: '', _from_cabinet: '', _from_part: '',
      });
    }
  });
  return { labelList, skipped };
}

export function downloadCustomOffcutsTemplate() {
  const sample = [
    { MATERIAL: '17.0_MR PLY_708 - SU - PURE ACACIA_LIGHT BROWN CAMBRIC 6965 SUD', LENGTH: 600, WIDTH: 450, BIN: 'A', QTY: 2 },
    { MATERIAL: '18.0_MR PLY_LIGHT BROWN CAMBRIC 6965 SUD_LIGHT BROWN CAMBRIC 6965 SUD', LENGTH: 900, WIDTH: 300, BIN: 'B', QTY: 1 },
  ];
  downloadCSV(sample, ['MATERIAL', 'LENGTH', 'WIDTH', 'BIN', 'QTY'], 'custom_offcuts_template.csv');
}

export function downloadCSV(rows, fields, filename) {
  // newline:'\n' matches the source system's export exactly (bare LF, not CRLF).
  const csv = Papa.unparse({ fields, data: rows }, { newline: '\n' });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function inventoryToCSVRows(inventory) {
  return inventory.map((o) => ({ ITEM_CODE: o.material, ITEM_NAME: o.material, BIN: o.bin, LENGTH: o.length, WIDTH: o.width, REQD: o.qty }));
}
