import { useCallback, useEffect, useState } from 'react'
import { loadCategories, loadPlan, summarise, saveProgress } from './api'

// Categories + the selected project's plan, with optimistic per-task progress saves.
export function useProject(projectId) {
  const [categories, setCategories] = useState([])
  const [plan, setPlan] = useState({ rooms: [], items: [] })
  const [state, setState] = useState({ loading: true, error: null })

  const reload = useCallback(async () => {
    if (!projectId) { setPlan({ rooms: [], items: [] }); setState({ loading: false, error: null }); return }
    try {
      const cats = await loadCategories()
      setCategories(cats)
      setPlan(await loadPlan(projectId, cats))
      setState({ loading: false, error: null })
    } catch (e) { setState({ loading: false, error: e.message }) }
  }, [projectId])

  useEffect(() => { setState({ loading: true, error: null }); reload() }, [reload])

  // Sets one task's % on an item. Rolls back and rethrows if the save fails.
  const setTask = useCallback(async (itemId, idx, value) => {
    const prev = plan
    const item = plan.items.find((i) => i.id === itemId)
    const next = [...item.progress]
    for (let k = 0; k <= idx; k++) next[k] = Number(next[k]) || 0
    next[idx] = value
    setPlan((p) => ({ ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, progress: next } : i)) }))
    try { await saveProgress(itemId, next) } catch (e) { setPlan(prev); throw e }
  }, [plan])

  return { categories, plan, summary: summarise(plan), ...state, reload, setTask }
}
