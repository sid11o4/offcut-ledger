import { jsPDF } from 'jspdf';
import { DIAGRAM_PALETTE } from './matching';

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const PDF_COLORS = {
  walnut: hexToRgb('#3B2A20'),
  copper: hexToRgb('#B8752B'),
  sage: hexToRgb('#3F6B4B'),
  ink: hexToRgb('#20241F'),
  inkSoft: hexToRgb('#5B5F56'),
  line: hexToRgb('#C9C6B8'),
  paper: hexToRgb('#F1F0EA'),
  copperSoft: hexToRgb('#EAD3AF'),
};

function downloadBlob(doc, filename) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// One landscape page per physical offcut that got cut this run — a to-scale layout of every
// panel placed on it, plus a summary page listing every offcut needed for the run.
export function generateCuttingDiagramsPDF(diagrams, { cutlistFileName, matchedCount, kerf }) {
  if (!diagrams.length) throw new Error('No matched panels to diagram — run matching first');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const PW = 297, PH = 210, M = 12;

  function drawPageHeader(subtitle) {
    doc.setFillColor(...PDF_COLORS.walnut);
    doc.rect(0, 0, PW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('OFFCUT CUTTING DIAGRAM', M, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.copperSoft);
    doc.text(subtitle, M, 15.5);
    doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
    doc.setTextColor(220, 210, 195);
    doc.text(`${cutlistFileName || 'cutlist'}  |  ${new Date().toLocaleDateString()}`, PW - M, 15.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  const cols = [
    { label: 'Layout', w: 15 }, { label: 'Offcut Size (mm)', w: 34 }, { label: 'Material', w: 95 },
    { label: 'Bin', w: 13 }, { label: 'Panels', w: 16 }, { label: 'Panel Area', w: 28 }, { label: 'Yield', w: 18 },
  ];
  let sy = 30;
  function drawSummaryTableHeader() {
    doc.setFillColor(...PDF_COLORS.paper);
    doc.rect(M, sy, PW - 2 * M, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.ink);
    let cx = M + 2;
    cols.forEach((c) => { doc.text(c.label, cx, sy + 5); cx += c.w; });
    sy += 10;
  }

  drawPageHeader(`OFFCUTS NEEDED FOR THIS RUN  —  ${diagrams.length} piece${diagrams.length > 1 ? 's' : ''}, ${matchedCount} panels total`);
  drawSummaryTableHeader();

  let totalOffcutArea = 0, totalPanelArea = 0;
  diagrams.forEach((d) => {
    if (sy > PH - 22) { doc.addPage('a4', 'landscape'); drawPageHeader('OFFCUTS NEEDED FOR THIS RUN (continued)'); drawSummaryTableHeader(); }
    const panelArea = d.panels.reduce((s, p) => s + (parseFloat(p['CUT_LENGTH']) || 0) * (parseFloat(p['CUT_WIDTH']) || 0), 0);
    const offcutArea = d.originLength * d.originWidth;
    totalOffcutArea += offcutArea; totalPanelArea += panelArea;
    const yieldPct = offcutArea ? (panelArea / offcutArea * 100) : 0;

    let cx = M + 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...PDF_COLORS.copper);
    doc.text(d.layoutLabel, cx, sy); cx += cols[0].w;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_COLORS.ink);
    doc.text(`${d.originLength} x ${d.originWidth}`, cx, sy); cx += cols[1].w;
    doc.text(doc.splitTextToSize(d.material, cols[2].w - 2)[0], cx, sy); cx += cols[2].w;
    doc.text(String(d.bin), cx, sy); cx += cols[3].w;
    doc.text(String(d.panels.length), cx, sy); cx += cols[4].w;
    doc.text(`${(panelArea / 1e6).toFixed(2)} m²`, cx, sy); cx += cols[5].w;
    doc.text(`${yieldPct.toFixed(0)}%`, cx, sy);
    sy += 5.2;
    doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.1);
    doc.line(M, sy - 2.6, PW - M, sy - 2.6);
    sy += 1.5;
  });

  sy += 4;
  doc.setDrawColor(...PDF_COLORS.ink); doc.setLineWidth(0.3);
  doc.line(M, sy - 3, PW - M, sy - 3);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.ink);
  const overallYield = totalOffcutArea ? (totalPanelArea / totalOffcutArea * 100) : 0;
  doc.text(`TOTAL: ${diagrams.length} offcuts  ·  ${(totalPanelArea / 1e6).toFixed(2)} m² of panels from ${(totalOffcutArea / 1e6).toFixed(2)} m² of offcut  ·  overall yield ${overallYield.toFixed(1)}%`, M, sy);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text('© Formgrid Interior Solutions — proprietary', M, PH - 6);

  doc.addPage('a4', 'landscape');

  diagrams.forEach((d, i) => {
    if (i > 0) doc.addPage('a4', 'landscape');

    doc.setFillColor(...PDF_COLORS.walnut);
    doc.rect(0, 0, PW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('OFFCUT CUTTING DIAGRAM', M, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.copperSoft);
    doc.text(`Layout ${d.layoutLabel}  —  offcut ${i + 1} of ${diagrams.length}  —  ${d.panels.length} panel${d.panels.length > 1 ? 's' : ''} from one board`, M, 15.5);
    doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
    doc.setTextColor(220, 210, 195);
    doc.text(`${cutlistFileName || 'cutlist'}  |  ${new Date().toLocaleDateString()}`, PW - M, 15.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    const colX = M, colW = 82;
    let ty = 30;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text('STOCK DIMENSIONS', colX, ty); ty += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
    doc.text(`${d.originLength} x ${d.originWidth} mm`, colX, ty); ty += 7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.inkSoft);
    const matLines = doc.splitTextToSize(`MATERIAL: ${d.material}`, colW);
    matLines.forEach((l) => { doc.text(l, colX, ty); ty += 3.8; });
    doc.text(`BIN: ${d.bin}    KERF: ${kerf || 0}mm`, colX, ty); ty += 7;

    doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.2);
    doc.line(colX, ty, colX + colW, ty); ty += 5;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text('PANELS IN THIS LAYOUT', colX, ty); ty += 5;
    d.panels.forEach((p) => {
      doc.setFont('courier', 'bold'); doc.setFontSize(7.5);
      doc.setTextColor(...PDF_COLORS.copper);
      doc.text(`${p._cut_sequence}.`, colX, ty);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_COLORS.ink);
      doc.text(String(p['PANEL_CODE'] || ''), colX + 6, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.inkSoft);
      doc.text(`${p['CUT_LENGTH']} x ${p['CUT_WIDTH']} mm (${p._orientation})`, colX + 6, ty + 3.4);
      const partLines = doc.splitTextToSize(String(p['PART_NAME'] || ''), colW - 6);
      doc.text(partLines.slice(0, 1), colX + 6, ty + 6.6);
      ty += 11;
      if (ty > PH - 18) { return; }
    });

    const dx = colX + colW + 10, dW = PW - M - dx, dH = PH - 38;
    const dy = 30;
    doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.2);
    doc.rect(dx, dy, dW, dH);
    const scale = Math.min(dW / d.originLength, dH / d.originWidth) * 0.94;
    const oW = d.originLength * scale, oH = d.originWidth * scale;
    const ox = dx + (dW - oW) / 2, oy = dy + (dH - oH) / 2;

    doc.setDrawColor(...PDF_COLORS.ink); doc.setLineWidth(0.5);
    doc.setFillColor(247, 243, 236);
    doc.rect(ox, oy, oW, oH, 'FD');

    d.panels.forEach((p, idx) => {
      const px = ox + p._rect_x * scale, py = oy + p._rect_y * scale;
      const pw = p._rect_w * scale, ph = p._rect_h * scale;
      const col = hexToRgb(DIAGRAM_PALETTE[idx % DIAGRAM_PALETTE.length]);
      doc.setFillColor(...col);
      doc.setDrawColor(...PDF_COLORS.sage); doc.setLineWidth(0.35);
      doc.rect(px, py, pw, ph, 'FD');
      if (pw > 18 && ph > 9) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(8, pw / 9));
        doc.setTextColor(...PDF_COLORS.ink);
        doc.text(String(p['PANEL_CODE'] || ''), px + pw / 2, py + ph / 2 - 1.3, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(6.5, pw / 11));
        doc.setTextColor(...PDF_COLORS.inkSoft);
        doc.text(`${p['CUT_LENGTH']}x${p['CUT_WIDTH']}`, px + pw / 2, py + ph / 2 + 3.2, { align: 'center' });
      }
      doc.setFillColor(...PDF_COLORS.copper);
      doc.circle(px + 3.2, py + 3.2, 2.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(4.6);
      doc.setTextColor(255, 255, 255);
      doc.text(String(p._cut_sequence), px + 3.2, py + 4.1, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    });
    d.trim.forEach((t) => {
      const tx = ox + t.x * scale, ty2 = oy + t.y * scale, tw = t.w * scale, th = t.h * scale;
      if (tw < 0.5 || th < 0.5) return;
      doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.2);
      doc.setLineDashPattern([1, 1], 0);
      doc.rect(tx, ty2, tw, th);
      doc.setLineDashPattern([], 0);
    });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.setTextColor(...PDF_COLORS.inkSoft);
    doc.text('Solid fill = panel cut this run (numbered = cut order)   ·   dashed outline = trim left on the board', dx, dy + dH + 5);
    doc.text(`Page ${i + 1} of ${diagrams.length}`, PW - M, PH - 6, { align: 'right' });
    doc.text('© Formgrid Interior Solutions — proprietary', M, PH - 6);
    doc.setTextColor(0, 0, 0);
  });

  downloadBlob(doc, `Offcut_Cutting_Diagrams_${Date.now()}.pdf`);
}

export function generateSchedulePDF(groupsArr, { cutlistFileName, kerf }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, M = 15;
  let page = 1;

  function drawWatermark() {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(28);
    doc.setTextColor(232, 232, 230);
    for (let ty = 60; ty < PH; ty += 70) {
      doc.text('FORMGRID INTERIOR SOLUTIONS', PW / 2, ty, { align: 'center', angle: 35 });
    }
    doc.setTextColor(0, 0, 0);
  }
  function drawHeader() {
    drawWatermark();
    doc.setFillColor(...PDF_COLORS.walnut);
    doc.rect(0, 0, PW, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('OFFCUT LEDGER', M, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.copperSoft);
    doc.text('CONTINUOUS CUTTING SCHEDULE', M, 17.5);
    doc.setFont('courier', 'normal'); doc.setFontSize(8);
    doc.setTextColor(220, 210, 195);
    doc.text(`${cutlistFileName || 'cutlist'}  |  kerf ${kerf}mm  |  ${new Date().toLocaleDateString()}`, PW - M, 17.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }
  function drawFooter() {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.setTextColor(...PDF_COLORS.inkSoft);
    doc.text(`Page ${page}`, PW / 2, PH - 8, { align: 'center' });
    doc.text('© Formgrid Interior Solutions — proprietary', M, PH - 8);
    doc.setTextColor(0, 0, 0);
  }
  function newPage() {
    drawFooter();
    doc.addPage();
    page++;
    drawHeader();
    y = 32;
  }

  let y = 32;
  drawHeader();

  groupsArr.forEach((g) => {
    const multi = g.rows.length > 1;
    const lineHeight = 5.2;
    const headerHeight = 8;
    const boxPadding = 4;
    const neededHeight = headerHeight + g.rows.length * lineHeight + boxPadding * 2 + 4;

    if (y + neededHeight > PH - 20) newPage();

    const boxTop = y;
    const boxHeight = neededHeight - 4;

    doc.setFillColor(...(multi ? PDF_COLORS.copper : PDF_COLORS.line));
    doc.rect(M, boxTop, 2, boxHeight, 'F');

    doc.setDrawColor(...PDF_COLORS.line);
    doc.setLineWidth(0.2);
    doc.rect(M, boxTop, PW - 2 * M, boxHeight);

    let ty = boxTop + boxPadding + 3;
    doc.setFont('courier', 'bold'); doc.setFontSize(9.5);
    doc.setTextColor(...(multi ? PDF_COLORS.copper : PDF_COLORS.ink));
    const headerText = multi
      ? `>> CONTINUOUS SEQUENCE — ${g.rows.length} panels from one offcut`
      : 'SINGLE CUT';
    doc.text(headerText, M + 6, ty);
    ty += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.inkSoft);
    doc.text(`${g.label}   |   ${g.material}`, M + 6, ty);
    ty += 6;

    g.rows.forEach((r) => {
      doc.setFont('courier', 'bold'); doc.setFontSize(8.5);
      doc.setTextColor(...PDF_COLORS.ink);
      doc.text(`${r._cut_sequence}.`, M + 6, ty);
      doc.text(String(r['PANEL_CODE'] || ''), M + 14, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.setTextColor(...PDF_COLORS.ink);
      let line = `${r['CUT_LENGTH']} x ${r['CUT_WIDTH']} mm  (${r._orientation})  —  from offcut piece ${r._offcut_size} mm`;
      doc.text(line, M + 42, ty);
      if (r._substituted) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.setTextColor(...PDF_COLORS.copper);
        doc.text('SUBSTITUTED', PW - M - 6, ty, { align: 'right' });
        doc.setTextColor(...PDF_COLORS.ink);
      }
      ty += lineHeight;
    });

    y = boxTop + boxHeight + 6;
  });

  drawFooter();
  downloadBlob(doc, `Offcut_Cutting_Schedule_${Date.now()}.pdf`);
}

// Parses a "{thickness}_{material}" edge column value.
function parseEdgeSpec(val) {
  const s = String(val || '').trim();
  if (!s) return null;
  const idx = s.indexOf('_');
  if (idx === -1) return { thk: parseFloat(s) || 0, material: '' };
  const thk = parseFloat(s.slice(0, idx));
  return { thk: isNaN(thk) ? 0 : thk, material: s.slice(idx + 1).trim() };
}
function edgeSpecLabel(spec) { return spec ? `${spec.thk}mm ${spec.material}`.trim() : ''; }

function drawEdgeDiagram(doc, x, y, w, h, sides) {
  doc.setDrawColor(210, 208, 200); doc.setLineWidth(0.25);
  doc.rect(x, y, w, h);
  doc.setDrawColor(184, 117, 43); doc.setLineWidth(1);
  if (sides.top) doc.line(x, y, x + w, y);
  if (sides.bottom) doc.line(x, y + h, x + w, y + h);
  if (sides.left) doc.line(x, y, x, y + h);
  if (sides.right) doc.line(x + w, y, x + w, y + h);
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2);
}

function drawLabel(doc, row) {
  const W = 75, H = 100, M = 4;
  doc.setLineWidth(0.3);
  doc.rect(2, 2, W - 4, H - 4);

  let y = 12.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text(String(row['PANEL_CODE'] || ''), W / 2, y, { align: 'center' });
  y += 4;
  doc.setLineWidth(0.2); doc.line(M, y, W - M, y);
  y += 4.8;

  function field(label, value, opts) {
    opts = opts || {};
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2);
    doc.text(label, M, y);
    y += 3.3;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 7.2);
    const lines = doc.splitTextToSize(String(value || ''), W - 2 * M);
    lines.forEach((l) => { doc.text(l, M, y); y += (opts.size || 7.2) * 0.5; });
    y += 0.4;
  }
  const materialLabel = row['_substituted'] ? 'BOARD TYPE / MATERIAL (SUBSTITUTED)' : 'BOARD TYPE / MATERIAL';
  field(materialLabel, row['_offcut_material'] || row['MATERIAL'], { bold: true, size: 6.8 });
  field('PROJECT  /  ROOM', `${row['PROJECT_NAME'] || ''}  /  ${row['ROOM'] || ''}`);
  field('CABINET', `${row['CABINET_NAME'] || ''} (${row['CABINET_NUMBER'] || ''})`);
  field('PART NAME', row['PART_NAME']);

  y += 0.3;
  doc.setLineWidth(0.2); doc.line(M, y, W - M, y);
  y += 4.8;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.text('FINISH SIZE (mm)', M, y);
  doc.setFontSize(11);
  doc.text(`${row['FINISH_LENGTH'] || ''} x ${row['FINISH_WIDTH'] || ''}`, W - M, y, { align: 'right' });
  y += 3.6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2);
  doc.text(`THK: ${row['FINISH_THK'] || ''} mm`, M, y);
  y += 6.2;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.text('CUT SIZE (mm)', M, y);
  doc.setFontSize(13);
  doc.text(`${row['CUT_LENGTH'] || ''} x ${row['CUT_WIDTH'] || ''}`, W - M, y, { align: 'right' });
  y += 4.3;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2);
  doc.text(`THK: ${row['CUT_THK'] || ''} mm`, M, y);
  y += 4;

  const edges = {
    top: parseEdgeSpec(row['TOP_EDGE']), bottom: parseEdgeSpec(row['BOTTOM_EDGE']),
    left: parseEdgeSpec(row['LEFT_EDGE']), right: parseEdgeSpec(row['RIGHT_EDGE']),
  };
  const bandedSides = Object.keys(edges).filter((k) => edges[k]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2);
  doc.setTextColor(91, 95, 86);
  doc.text('EDGEBANDING', M, y);
  doc.setTextColor(0, 0, 0);
  y += 2.2;

  const diagX = M, diagY = y, diagW = 11, diagH = 8.5;
  drawEdgeDiagram(doc, diagX, diagY, diagW, diagH, {
    top: !!edges.top, bottom: !!edges.bottom, left: !!edges.left, right: !!edges.right,
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(4.3);
  doc.setTextColor(140, 140, 136);
  doc.text('T', diagX + diagW / 2, diagY - 0.7, { align: 'center' });
  doc.text('B', diagX + diagW / 2, diagY + diagH + 2.6, { align: 'center' });
  doc.text('L', diagX - 1.5, diagY + diagH / 2 + 0.8, { align: 'center' });
  doc.text('R', diagX + diagW + 1.7, diagY + diagH / 2 + 0.8, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  const tx = diagX + diagW + 5.5;
  let ty = diagY + 2.6;
  const sideName = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  if (!bandedSides.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6);
    doc.setTextColor(140, 60, 50);
    doc.text('No sides banded', tx, ty);
    doc.setTextColor(0, 0, 0);
  } else {
    const groups = {};
    bandedSides.forEach((k) => { const key = edgeSpecLabel(edges[k]); (groups[key] = groups[key] || []).push(sideName(k)); });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6);
    Object.entries(groups).forEach(([spec, sides]) => {
      doc.setTextColor(0, 0, 0);
      doc.splitTextToSize(`${sides.join('/')}: ${spec}`, W - tx - M).slice(0, 2).forEach((l) => { doc.text(l, tx, ty); ty += 2.9; });
    });
    const unbanded = ['top', 'bottom', 'left', 'right'].filter((k) => !edges[k]);
    if (unbanded.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5);
      doc.setTextColor(140, 60, 50);
      doc.text(`No band: ${unbanded.map(sideName).join(', ')}`, tx, ty);
      doc.setTextColor(0, 0, 0);
    }
  }

  if (row['_offcut_size']) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
    doc.setTextColor(184, 117, 43);
    doc.text(`FROM OFFCUT: ${row['_offcut_size']} mm  |  BIN ${row['_offcut_bin'] || ''}  |  ${row['_orientation'] || ''}`, W / 2, H - 10, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(6);
  doc.text(`S.No: ${row['S_NO'] || ''}`, W / 2, H - 5, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(4.2);
  doc.setTextColor(190, 190, 188);
  doc.text('Formgrid Interior Solutions', W / 2, H - 2.3, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

export function printLabels(matched) {
  if (!matched.length) throw new Error('No matched panels to print');
  const doc = new jsPDF({ unit: 'mm', format: [75, 100] });
  matched.forEach((row, i) => {
    if (i > 0) doc.addPage([75, 100]);
    drawLabel(doc, row);
  });
  downloadBlob(doc, `Offcut_Panel_Labels_${Date.now()}.pdf`);
}

// Wrap label: same 75x100mm sheet, split into 3 identical horizontal bands so it stays
// legible from any side of a stacked offcut (top face, edge, bottom face).
function drawWrapLabelBand(doc, r, bandTop, bandH, bandIdx) {
  const W = 75, M = 4;
  let y = bandTop + 5.5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
  doc.setTextColor(184, 117, 43);
  doc.text(`LEFTOVER OFFCUT  ·  BIN ${r.bin || ''}`, M, y);
  y += 4.4;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
  doc.setTextColor(0, 0, 0);
  const matLines = doc.splitTextToSize(String(r.material || ''), W - 2 * M);
  matLines.slice(0, 2).forEach((l) => { doc.text(l, M, y); y += 3.2; });
  y += 0.6;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(`${r.length} x ${r.width} mm`, M, y);
  y += 4.6;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.setTextColor(91, 95, 86);
  if (r._from_project || r._from_panel || r._from_cabinet) {
    doc.text(`FROM: ${r._from_project || ''} / ${r._from_room || ''}`, M, y);
    y += 3.1;
    doc.text(`${r._from_cabinet || ''} — ${r._from_part || ''} (${r._from_panel || ''})`, M, y);
  } else {
    doc.text('Manually added to stock — no job reference', M, y);
  }
  doc.setTextColor(0, 0, 0);

  if (bandIdx < 2) {
    doc.setDrawColor(200, 200, 196);
    doc.setLineDashPattern([1, 1], 0);
    doc.setLineWidth(0.25);
    doc.line(2, bandTop + bandH, W - 2, bandTop + bandH);
    doc.setLineDashPattern([], 0);
  }
}

function drawWrapLabel(doc, r) {
  const W = 75, H = 100;
  doc.setLineWidth(0.3);
  doc.rect(2, 2, W - 4, H - 4);
  const bandH = (H - 4) / 3;
  const labels = ['TOP FACE', 'EDGE', 'BOTTOM FACE'];
  for (let i = 0; i < 3; i++) {
    const bandTop = 2 + i * bandH;
    drawWrapLabelBand(doc, r, bandTop, bandH, i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(4.8);
    doc.setTextColor(190, 190, 188);
    doc.text(labels[i], W - 4, bandTop + 4, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(4.2);
  doc.setTextColor(190, 190, 188);
  doc.text('Formgrid Interior Solutions', W / 2, H - 2.3, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

export function generateWrapLabelsPDF(list, filenamePrefix) {
  if (!list.length) throw new Error('No offcuts to label');
  const doc = new jsPDF({ unit: 'mm', format: [75, 100] });
  list.forEach((r, i) => {
    if (i > 0) doc.addPage([75, 100]);
    drawWrapLabel(doc, r);
  });
  downloadBlob(doc, `${filenamePrefix}_${Date.now()}.pdf`);
}
