import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as storage from '../lib/storage';
import { normMat, uid, runMatching as runMatchingEngine, verifyResults } from '../lib/matching';
import { rowsToInventoryEntries } from '../lib/csv';

const AppContext = createContext(null);

const initialState = {
  tab: 'inventory',
  inventory: [],
  cutlistRows: [],
  cutlistFields: [],
  cutlistFileName: '',
  matched: [],
  remaining: [],
  newRemnants: [],
  discardedOffcuts: [],
  originTrimRects: [],
  hasRun: false,
  pendingInventory: [],
  applied: false,
  kerf: 5,
  unexposedMaterials: [],
  discardRules: [],
  projects: [],
  historicalView: false,
  viewingProjectName: null,
  verification: [],
  lastImportSkips: [],
  loading: true,
};

export function AppProvider({ children }) {
  const [state, setState] = useState(initialState);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const patch = useCallback((partial) => setState((s) => ({ ...s, ...partial })), []);

  useEffect(() => {
    (async () => {
      try {
        const [inventory, unexposedMaterials, discardRules, projects] = await Promise.all([
          storage.fetchInventory(),
          storage.fetchUnexposedMaterials(),
          storage.fetchDiscardRules(),
          storage.fetchProjects(),
        ]);
        patch({ inventory, unexposedMaterials, discardRules, projects, loading: false });
      } catch (err) {
        console.error(err);
        toast('Could not load data from Supabase — check your .env configuration');
        patch({ loading: false });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = useCallback((tab) => patch({ tab }), [patch]);

  /* ---------------- Inventory ---------------- */
  // Side effects must not live inside a setState updater — React (StrictMode, in dev) may
  // invoke updater functions more than once to check for impurity, which would double-fire
  // the Supabase call. Read current state from the closure instead and call setState once.
  const addInventoryEntry = useCallback(async ({ material, length, width, bin, qty }) => {
    const existing = state.inventory.find((o) => normMat(o.material) === normMat(material) && o.length === length && o.width === width && o.bin === bin);
    if (existing) {
      const newQty = existing.qty + qty;
      setState((s) => ({ ...s, inventory: s.inventory.map((o) => (o.id === existing.id ? { ...o, qty: newQty } : o)) }));
      try { await storage.updateInventoryQty(existing.id, newQty); } catch (err) { console.error(err); toast('Could not save inventory'); }
      return;
    }
    const tempId = uid();
    setState((s) => ({ ...s, inventory: [...s.inventory, { id: tempId, material, length, width, bin, qty }] }));
    try {
      const row = await storage.insertInventoryRow({ material, length, width, bin, qty });
      setState((s) => ({ ...s, inventory: s.inventory.map((o) => (o.id === tempId ? row : o)) }));
    } catch (err) { console.error(err); toast('Could not save inventory'); }
  }, [state.inventory, toast]);

  const deleteInventoryEntry = useCallback(async (id) => {
    setState((s) => ({ ...s, inventory: s.inventory.filter((o) => o.id !== id) }));
    try { await storage.deleteInventoryRow(id); } catch (err) { console.error(err); toast('Could not delete inventory row'); }
  }, [toast]);

  const clearAllInventory = useCallback(async () => {
    try {
      await storage.clearInventory();
      patch({ inventory: [] });
      toast('Inventory cleared');
    } catch (err) { console.error(err); toast('Could not clear inventory'); }
  }, [patch, toast]);

  // Merges parsed CSV/XLSX rows into inventory, same merge-by material+length+width+bin
  // semantics as the original app, but persists only the rows that actually changed.
  const importInventoryRows = useCallback(async (rawRows, sourceLabel) => {
    const before = state.inventory;
    const working = before.map((o) => ({ ...o }));
    const res = rowsToInventoryEntries(rawRows, working);

    const beforeById = new Map(before.map((o) => [o.id, o]));
    const ops = [];
    const idRemap = new Map();
    working.forEach((o) => {
      const prior = beforeById.get(o.id);
      if (!prior) {
        ops.push(storage.insertInventoryRow({ material: o.material, length: o.length, width: o.width, bin: o.bin, qty: o.qty }).then((row) => idRemap.set(o.id, row)));
      } else if (prior.qty !== o.qty) {
        ops.push(storage.updateInventoryQty(o.id, o.qty));
      }
    });
    try {
      await Promise.all(ops);
      const finalInventory = working.map((o) => idRemap.get(o.id) || o);
      patch({ inventory: finalInventory, lastImportSkips: res.skipped });
      toast(`${sourceLabel}: ${res.added} added, ${res.merged} merged${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}`);
    } catch (err) {
      console.error(err);
      toast('Could not save imported inventory');
    }
    return res;
  }, [state.inventory, patch, toast]);

  /* ---------------- Cutlist / settings ---------------- */
  const setCutlist = useCallback((rows, fields, fileName) => {
    patch({ cutlistRows: rows, cutlistFields: fields, cutlistFileName: fileName, hasRun: false, matched: [], remaining: [] });
  }, [patch]);

  const setKerf = useCallback((kerf) => patch({ kerf }), [patch]);

  const addUnexposedRule = useCallback(async (rule) => {
    try {
      const saved = await storage.insertUnexposedMaterial(rule);
      setState((s) => ({ ...s, unexposedMaterials: [...s.unexposedMaterials, saved] }));
      toast('Rule added');
    } catch (err) { console.error(err); toast('Could not save unexposed materials list'); }
  }, [toast]);

  const deleteUnexposedRule = useCallback(async (id) => {
    setState((s) => ({ ...s, unexposedMaterials: s.unexposedMaterials.filter((u) => u.id !== id) }));
    try { await storage.deleteUnexposedMaterial(id); } catch (err) { console.error(err); toast('Could not save unexposed materials list'); }
  }, [toast]);

  const addDiscardRule = useCallback(async (rule) => {
    try {
      const saved = await storage.insertDiscardRule(rule);
      setState((s) => ({ ...s, discardRules: [...s.discardRules, saved] }));
      toast('Rule added');
    } catch (err) { console.error(err); toast('Could not save discard rules'); }
  }, [toast]);

  const deleteDiscardRule = useCallback(async (id) => {
    setState((s) => ({ ...s, discardRules: s.discardRules.filter((r) => r.id !== id) }));
    try { await storage.deleteDiscardRule(id); } catch (err) { console.error(err); toast('Could not save discard rules'); }
  }, [toast]);

  /* ---------------- Matching ---------------- */
  const runMatchingAction = useCallback(() => {
    const result = runMatchingEngine({
      inventory: state.inventory,
      cutlistRows: state.cutlistRows,
      kerf: state.kerf,
      unexposedMaterials: state.unexposedMaterials,
      discardRules: state.discardRules,
    });
    patch({
      ...result,
      hasRun: true,
      applied: false,
      historicalView: false,
      viewingProjectName: null,
      tab: 'results',
    });
    toast(`Previewed ${result.matched.length} panel matches — review and apply on Results`);
  }, [state.inventory, state.cutlistRows, state.kerf, state.unexposedMaterials, state.discardRules, patch, toast]);

  const applyToInventory = useCallback(async () => {
    try {
      const rows = await storage.replaceInventory(state.pendingInventory);
      patch({ inventory: rows, applied: true });
      toast('Inventory updated');
    } catch (err) { console.error(err); toast('Could not save inventory'); }
  }, [state.pendingInventory, patch, toast]);

  const saveProject = useCallback(async (name) => {
    const project = {
      name,
      savedAt: Date.now(),
      cutlistFileName: state.cutlistFileName,
      cutlistFields: state.cutlistFields,
      cutlistRows: state.cutlistRows,
      kerf: state.kerf,
      matched: state.matched,
      remaining: state.remaining,
      applied: state.applied,
      newRemnants: state.newRemnants,
      discardedOffcuts: state.discardedOffcuts,
      originTrimRects: state.originTrimRects,
    };
    try {
      const saved = await storage.insertProject(project);
      setState((s) => ({ ...s, projects: [saved, ...s.projects] }));
      toast('Project saved to history');
    } catch (err) { console.error(err); toast('Could not save project'); }
  }, [state, toast]);

  const openProject = useCallback((p) => {
    const matched = p.matched || [];
    const remaining = p.remaining || [];
    const cutlistRows = p.cutlistRows || [];
    const unexposedMaterials = state.unexposedMaterials;
    const pendingInventory = state.pendingInventory;
    const verification = verifyResults({ matched, remaining, cutlistRows, unexposedMaterials, pendingInventory });
    patch({
      matched, remaining,
      cutlistFileName: p.cutlistFileName,
      cutlistFields: p.cutlistFields || [],
      cutlistRows,
      kerf: p.kerf,
      newRemnants: p.newRemnants || [],
      discardedOffcuts: p.discardedOffcuts || [],
      originTrimRects: p.originTrimRects || [],
      hasRun: true,
      historicalView: true,
      viewingProjectName: p.name,
      tab: 'results',
      verification,
    });
  }, [state.unexposedMaterials, state.pendingInventory, patch]);

  const deleteProjectAction = useCallback(async (id) => {
    try {
      await storage.deleteProject(id);
      setState((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id) }));
      toast('Project deleted');
    } catch (err) { console.error(err); toast('Could not delete project'); }
  }, [toast]);

  const value = useMemo(() => ({
    state, toast, toastMsg, toastVisible,
    setTab, addInventoryEntry, deleteInventoryEntry, clearAllInventory, importInventoryRows,
    setCutlist, setKerf, addUnexposedRule, deleteUnexposedRule, addDiscardRule, deleteDiscardRule,
    runMatchingAction, applyToInventory, saveProject, openProject, deleteProjectAction,
  }), [state, toast, toastMsg, toastVisible, setTab, addInventoryEntry, deleteInventoryEntry,
    clearAllInventory, importInventoryRows, setCutlist, setKerf, addUnexposedRule, deleteUnexposedRule,
    addDiscardRule, deleteDiscardRule, runMatchingAction, applyToInventory, saveProject, openProject, deleteProjectAction]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
