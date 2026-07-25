// Matching engine — ported from the original single-file app with the same algorithm and
// tie-breaking rules, just parameterized instead of reading/writing a global `App` object.

export const uid = () => Math.random().toString(36).slice(2, 10);

export function normMat(s) {
  return (s || '').toString().trim().toLowerCase();
}

export function extractThickness(material) {
  const m = String(material || '').match(/^\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export function findUnexposedRule(material, unexposedMaterials) {
  return unexposedMaterials.find((u) => normMat(u.material) === normMat(material));
}

// Can a panel needing `cutMaterial` be cut from an offcut of `offMaterial`?
// Exact match always works. If cutMaterial has an unexposed rule, any offcut whose
// thickness is in that rule's allowed substitute list works too — regardless of
// core/finish — since the panel will never be seen.
export function materialsCompatible(cutMaterial, offMaterial, unexposedMaterials) {
  if (normMat(cutMaterial) === normMat(offMaterial)) return true;
  const rule = findUnexposedRule(cutMaterial, unexposedMaterials);
  if (rule) {
    const t2 = extractThickness(offMaterial);
    return t2 !== null && rule.thicknesses.some((t) => Math.abs(t - t2) < 0.05);
  }
  return false;
}

export function explodeInventory(inv) {
  // Turn aggregated {qty:N} rows into individual physical pieces, each with its
  // own lineage id — so we can tell which panels came from the *same* physical offcut.
  // x/y anchor each piece within its origin's own top-left-based coordinate frame, so the
  // whole cut tree on one physical board can later be drawn to scale as a single diagram.
  const out = [];
  inv.forEach((o) => {
    for (let i = 0; i < o.qty; i++) {
      const originId = uid();
      out.push({
        id: uid(), material: o.material, length: o.length, width: o.width, bin: o.bin, qty: 1,
        originId, originLabel: `${o.length} x ${o.width} (Bin ${o.bin})`,
        originLength: o.length, originWidth: o.width, isOriginal: true, x: 0, y: 0,
      });
    }
  });
  return out;
}

export function findBestOffcut(inv, material, cutL, cutW, usedOrigins, allowSubstitution, unexposedMaterials) {
  let candidates = [];
  inv.forEach((off) => {
    if (off.qty <= 0) return;
    const isExact = normMat(off.material) === normMat(material);
    if (!isExact) {
      if (!allowSubstitution) return; // phase 1: exact-material matches only
      if (!materialsCompatible(material, off.material, unexposedMaterials)) return;
    }
    const exact = isExact ? 0 : 1; // 0 = exact material, 1 = compatible substitute
    const fresh = usedOrigins.has(off.originId) ? 0 : 1; // 0 = already-opened offcut, prioritized
    if (off.length >= cutL && off.width >= cutW) {
      candidates.push({
        off, orientation: 'A', usedL: cutL, usedW: cutW, exact, fresh,
        excess: (off.length - cutL) + (off.width - cutW), area: off.length * off.width - cutL * cutW,
      });
    }
    if (off.length >= cutW && off.width >= cutL) {
      candidates.push({
        off, orientation: 'B', usedL: cutW, usedW: cutL, exact, fresh,
        excess: (off.length - cutW) + (off.width - cutL), area: off.length * off.width - cutL * cutW,
      });
    }
  });
  if (!candidates.length) return null;
  // Exact material match wins over a compatible substitute; then prefer an already-opened
  // offcut over a fresh one; tightest fit breaks remaining ties.
  candidates.sort((a, b) => a.exact - b.exact || a.fresh - b.fresh || a.excess - b.excess || a.area - b.area);
  return candidates[0];
}

// Should a remnant of this size, for this material, be kept as usable stock?
// A material-specific discard rule (if one exists) overrides the generic 100mm-side floor —
// the remnant must clear the rule's minimum in EITHER orientation to survive.
export function meetsKeepThreshold(material, length, width, discardRules) {
  const rule = discardRules.find((r) => normMat(r.material) === normMat(material));
  if (rule) {
    return (length >= rule.minLength && width >= rule.minWidth) || (length >= rule.minWidth && width >= rule.minLength);
  }
  return Math.min(length, width) >= 100;
}

// Splits the leftover of a cut into up to two guillotine remnants. Every geometrically valid
// remnant is returned here, regardless of size — the keep-vs-discard decision happens only
// AFTER matching finishes, once we know whether the run actually needed it for another panel.
export function computeRemnants(off, usedL, usedW, kerf) {
  const EPS = 0.5; // treat differences under this as "no cut needed on this axis"
  const rems = [];
  const lenLeftover = off.length - usedL;
  const widLeftover = off.width - usedW;
  if (lenLeftover > EPS) {
    const r1L = lenLeftover - kerf, r1W = off.width;
    if (r1L > 0) rems.push({ length: +r1L.toFixed(1), width: +r1W.toFixed(1), x: off.x + usedL, y: off.y });
  }
  if (widLeftover > EPS) {
    const r2L = usedL, r2W = widLeftover - kerf;
    if (r2W > 0) rems.push({ length: +r2L.toFixed(1), width: +r2W.toFixed(1), x: off.x, y: off.y + usedW });
  }
  return rems;
}

// Runs a full matching pass. Returns a plain object with the same shape as the fields the
// original app stored on `App` after runMatching() — does not mutate any of its inputs.
export function runMatching({ inventory, cutlistRows, kerf, unexposedMaterials, discardRules }) {
  kerf = kerf || 0;
  const workInv = explodeInventory(inventory);

  // Flatten every panel-unit across all rows.
  const allUnits = [];
  cutlistRows.forEach((row, rowIdx) => {
    const qty = parseInt(row['ITEM-QTY']) || 1;
    const cutL = parseFloat(row['CUT_LENGTH']);
    const cutW = parseFloat(row['CUT_WIDTH']);
    for (let i = 0; i < qty; i++) allUnits.push({ rowIdx, row, cutL, cutW, area: cutL * cutW });
  });

  const matched = [];
  const unmatchedByRow = {};
  const usedOrigins = new Set();
  const originSeq = {};

  function commitCut(u, best) {
    best.off.qty = 0;
    usedOrigins.add(best.off.originId);
    originSeq[best.off.originId] = (originSeq[best.off.originId] || 0) + 1;
    const rems = computeRemnants(best.off, best.usedL, best.usedW, kerf);
    rems.forEach((r) => {
      workInv.push({
        id: uid(), material: best.off.material, length: r.length, width: r.width, bin: best.off.bin, qty: 1,
        originId: best.off.originId, originLabel: best.off.originLabel,
        originLength: best.off.originLength, originWidth: best.off.originWidth, isOriginal: false,
        x: r.x, y: r.y,
        _from_panel: u.row['PANEL_CODE'], _from_project: u.row['PROJECT_NAME'], _from_room: u.row['ROOM'],
        _from_cabinet: u.row['CABINET_NAME'], _from_part: u.row['PART_NAME'],
      });
    });
    matched.push({
      ...u.row,
      _orientation: best.orientation === 'B' ? 'Rotated 90°' : 'As-is',
      _offcut_size: `${best.off.length} x ${best.off.width}`,
      _offcut_bin: best.off.bin,
      _offcut_material: best.off.material,
      _substituted: normMat(best.off.material) !== normMat(u.row['MATERIAL']),
      _origin_id: best.off.originId,
      _origin_label: best.off.originLabel,
      _origin_area_mm2: best.off.originLength * best.off.originWidth,
      _cut_sequence: originSeq[best.off.originId],
      _rect_x: best.off.x, _rect_y: best.off.y, _rect_w: best.usedL, _rect_h: best.usedW,
      _origin_length: best.off.originLength, _origin_width: best.off.originWidth,
    });
  }

  // Works through `units` largest-first, but with one extra rule: before ever opening a new
  // physical offcut, every remaining pending panel gets tried against whichever offcut is
  // CURRENTLY open, so one board is fully exhausted before attention moves to the next board.
  function packPass(units, allowSubstitution) {
    let pending = units.slice().sort((a, b) => b.area - a.area);
    const leftover = [];
    let currentOriginId = null;

    while (pending.length) {
      let idx = -1, cand = null;
      if (currentOriginId) {
        const originInv = workInv.filter((o) => o.originId === currentOriginId && o.qty > 0);
        for (let i = 0; i < pending.length; i++) {
          const u = pending[i];
          const c = findBestOffcut(originInv, u.row['MATERIAL'], u.cutL, u.cutW, usedOrigins, allowSubstitution, unexposedMaterials);
          if (c) { idx = i; cand = c; break; } // pending is largest-first, so first hit wins
        }
      }
      if (idx === -1) {
        // Current board can't take anything else pending — open the best-matching offcut
        // for the single largest remaining panel.
        currentOriginId = null;
        const u = pending[0];
        cand = findBestOffcut(workInv, u.row['MATERIAL'], u.cutL, u.cutW, usedOrigins, allowSubstitution, unexposedMaterials);
        if (!cand) { leftover.push(pending.shift()); continue; }
        idx = 0;
      }
      commitCut(pending[idx], cand);
      currentOriginId = cand.off.originId;
      pending.splice(idx, 1);
    }
    return leftover;
  }

  // Pass 1: fulfill every panel from an EXACT material match first, before any substitution
  // is considered — so substitution never crowds out real demand.
  const stillNeeded = packPass(allUnits, false);

  // Pass 2: only what's left after exact matching gets a shot at a compatible substitute.
  const stillNeeded2 = packPass(stillNeeded, true);
  stillNeeded2.forEach((u) => { unmatchedByRow[u.rowIdx] = (unmatchedByRow[u.rowIdx] || 0) + 1; });

  // Rebuild the "remaining" list in original cutlist row order
  const remaining = [];
  cutlistRows.forEach((row, rowIdx) => {
    const leftover = unmatchedByRow[rowIdx] || 0;
    if (leftover > 0) {
      const clone = { ...row };
      clone['ITEM-QTY'] = String(leftover);
      remaining.push(clone);
    }
  });

  // Snapshot of every surviving piece's position, per origin.
  const trimRects = workInv
    .filter((o) => o.qty > 0 && usedOrigins.has(o.originId))
    .map((o) => ({ originId: o.originId, x: o.x, y: o.y, w: o.length, h: o.width, kept: meetsKeepThreshold(o.material, o.length, o.width, discardRules) }));

  // Re-aggregate individual pieces back into grouped rows for storage.
  const grouped = {};
  const discarded = {};
  workInv.filter((o) => o.qty > 0).forEach((o) => {
    const keep = meetsKeepThreshold(o.material, o.length, o.width, discardRules);
    if (keep) {
      const key = normMat(o.material) + '|' + o.length + '|' + o.width + '|' + o.bin;
      if (!grouped[key]) grouped[key] = { id: uid(), material: o.material, length: o.length, width: o.width, bin: o.bin, qty: 0 };
      grouped[key].qty += o.qty;
    } else {
      const key = normMat(o.material) + '|' + o.length + '|' + o.width + '|' + o.bin + '|' + (o.isOriginal ? 'orig' : 'new');
      if (!discarded[key]) discarded[key] = { id: uid(), material: o.material, length: o.length, width: o.width, bin: o.bin, qty: 0, source: o.isOriginal ? 'Untouched stock' : 'Cut leftover' };
      discarded[key].qty += o.qty;
    }
  });

  // Wrap labels: only for pieces that were produced by a cut this run, are still uncut at
  // the end, and clear the material's keep-threshold.
  const newRemnants = workInv
    .filter((o) => o.qty > 0 && !o.isOriginal && meetsKeepThreshold(o.material, o.length, o.width, discardRules))
    .map((o) => ({
      material: o.material, length: o.length, width: o.width, bin: o.bin, _origin_label: o.originLabel,
      _from_panel: o._from_panel, _from_project: o._from_project, _from_room: o._from_room,
      _from_cabinet: o._from_cabinet, _from_part: o._from_part,
    }));

  const pendingInventory = Object.values(grouped);
  const discardedOffcuts = Object.values(discarded);

  const verification = verifyResults({
    matched, remaining, cutlistRows, unexposedMaterials, pendingInventory,
  });

  return {
    pendingInventory, discardedOffcuts, matched, remaining, newRemnants,
    originTrimRects: trimRects, verification,
  };
}

// Independent post-hoc audit of the matching results — re-derives correctness from raw
// numbers rather than trusting the matching engine's own bookkeeping.
export function verifyResults({ matched, remaining, cutlistRows, unexposedMaterials, pendingInventory }) {
  const issues = []; // {level:'error'|'warning', message}
  const EPS = 0.05;

  // 1. Geometric fit
  matched.forEach((m) => {
    const parts = m._offcut_size.split(' x ').map(Number);
    const oL = parts[0], oW = parts[1];
    const cutL = parseFloat(m['CUT_LENGTH']), cutW = parseFloat(m['CUT_WIDTH']);
    const rotated = m._orientation.startsWith('Rotated');
    const usedL = rotated ? cutW : cutL, usedW = rotated ? cutL : cutW;
    if (usedL > oL + EPS || usedW > oW + EPS) {
      issues.push({ level: 'error', message: `${m['PANEL_CODE']}: panel ${cutL} x ${cutW} does not actually fit offcut ${m._offcut_size} in the recorded orientation (${m._orientation}).` });
    }
  });

  // 2. Material compatibility
  matched.forEach((m) => {
    const needed = m['MATERIAL'], used = m._offcut_material;
    if (normMat(needed) === normMat(used)) return;
    const rule = unexposedMaterials.find((u) => normMat(u.material) === normMat(needed));
    if (!rule) {
      issues.push({ level: 'error', message: `${m['PANEL_CODE']}: cut from "${used}" but no substitution rule permits replacing "${needed}".` });
      return;
    }
    const t = extractThickness(used);
    if (t === null || !rule.thicknesses.some((x) => Math.abs(x - t) < 0.05)) {
      issues.push({ level: 'error', message: `${m['PANEL_CODE']}: substitute "${used}" (thickness ${t}) is outside the allowed [${rule.thicknesses.join(', ')}]mm list for "${needed}".` });
    }
  });

  // 3. Panel-unit conservation
  const matchedTotal = matched.length;
  const remainingTotal = remaining.reduce((s, r) => s + (parseInt(r['ITEM-QTY']) || 1), 0);
  if (!cutlistRows.length) {
    issues.push({ level: 'warning', message: `Original cutlist rows aren't available for this record, so panel-count conservation could not be re-checked.` });
  } else {
    const requiredTotal = cutlistRows.reduce((s, r) => s + (parseInt(r['ITEM-QTY']) || 1), 0);
    if (requiredTotal !== matchedTotal + remainingTotal) {
      issues.push({ level: 'error', message: `Panel-unit count mismatch: cutlist requires ${requiredTotal} units, but matched (${matchedTotal}) + remaining (${remainingTotal}) = ${matchedTotal + remainingTotal}.` });
    }
  }

  // 4. Physical conservation of area
  const originAreaUsed = {};
  matched.forEach((m) => {
    const cutL = parseFloat(m['CUT_LENGTH']), cutW = parseFloat(m['CUT_WIDTH']);
    originAreaUsed[m._origin_id] = (originAreaUsed[m._origin_id] || 0) + cutL * cutW;
  });
  Object.entries(originAreaUsed).forEach(([originId, usedArea]) => {
    const rowsForOrigin = matched.filter((m) => m._origin_id === originId);
    const originArea = rowsForOrigin[0]._origin_area_mm2;
    if (usedArea > originArea + 1) {
      issues.push({ level: 'error', message: `Offcut ${rowsForOrigin[0]._origin_label}: panels claim ${(usedArea / 1e6).toFixed(3)} m² total, more than the ${(originArea / 1e6).toFixed(3)} m² the physical piece actually has.` });
    }
  });

  // 5. Cut-sequence integrity
  const originSeqCheck = {};
  matched.forEach((m) => { (originSeqCheck[m._origin_id] = originSeqCheck[m._origin_id] || []).push(m._cut_sequence); });
  Object.entries(originSeqCheck).forEach(([originId, seqs]) => {
    const sorted = [...seqs].sort((a, b) => a - b);
    const expected = sorted.map((_, i) => i + 1);
    if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
      issues.push({ level: 'warning', message: `Offcut ${originId.slice(0, 6)}…: cut sequence numbers [${seqs.join(', ')}] aren't a clean 1..${seqs.length} run.` });
    }
  });

  // 6. Inventory sanity
  pendingInventory.forEach((o) => {
    if (!(o.qty > 0)) issues.push({ level: 'error', message: `Pending inventory entry for ${o.material} ${o.length}x${o.width} has invalid quantity (${o.qty}).` });
    if (!(o.length > 0) || !(o.width > 0)) issues.push({ level: 'error', message: `Pending inventory entry has invalid dimensions: ${o.material} ${o.length}x${o.width}.` });
  });

  // 7. Duplicate panel check
  const seenPanelKeys = new Set();
  matched.forEach((m) => {
    const key = `${m['PANEL_CODE']}|${m._cut_sequence}|${m._origin_id}`;
    if (seenPanelKeys.has(key)) {
      issues.push({ level: 'error', message: `Duplicate match detected for panel ${m['PANEL_CODE']} (same origin, same sequence).` });
    }
    seenPanelKeys.add(key);
  });

  return issues;
}

export function buildScheduleGroups(matched) {
  const originGroups = {};
  matched.forEach((m) => {
    (originGroups[m._origin_id] = originGroups[m._origin_id] || []).push(m['PANEL_CODE']);
  });
  return Object.entries(originGroups).map(([originId]) => {
    const rows = matched.filter((m) => m._origin_id === originId).sort((a, b) => a._cut_sequence - b._cut_sequence);
    return { originId, label: rows[0]._origin_label, material: rows[0]._offcut_material, rows };
  }).sort((a, b) => b.rows.length - a.rows.length);
}

// Full per-offcut cutting layout data — one entry per physical board that got cut this run.
export const DIAGRAM_PALETTE = ['#DCE7DD', '#EAD3AF', '#D9E3EF', '#F0DCD8', '#E3DCEF', '#DDEAE6', '#F3E6C7'];
export function buildOriginDiagrams(matched, originTrimRects) {
  const byOrigin = {};
  matched.forEach((m) => {
    if (!byOrigin[m._origin_id]) byOrigin[m._origin_id] = {
      originId: m._origin_id, originLabel: m._origin_label,
      originLength: null, originWidth: null, material: m._offcut_material, bin: m._offcut_bin,
      panels: [],
    };
    byOrigin[m._origin_id].panels.push(m);
  });
  const trimByOrigin = {};
  (originTrimRects || []).forEach((t) => { (trimByOrigin[t.originId] = trimByOrigin[t.originId] || []).push(t); });

  const diagrams = Object.values(byOrigin).map((g) => {
    g.panels.sort((a, b) => a._cut_sequence - b._cut_sequence);
    g.originLength = g.panels[0]._origin_length;
    g.originWidth = g.panels[0]._origin_width;
    g.trim = trimByOrigin[g.originId] || [];
    return g;
  });
  // Largest board first, matching the "biggest sheets get planned first" convention.
  diagrams.sort((a, b) => (b.originLength * b.originWidth) - (a.originLength * a.originWidth));
  diagrams.forEach((d, i) => { d.layoutLabel = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); });
  return diagrams;
}
