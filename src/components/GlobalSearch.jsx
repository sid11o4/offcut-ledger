import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { displayDate } from '../lib/dates'

// Global search across the entities spec section 50 names: projects, clients, daily logs, job
// entries, estimates, bills, expenses. RLS already scopes every query to what the signed-in
// user can see (e.g. bills only surface for billing/financial_reports holders), so this needs
// no extra permission logic of its own -- an empty section for a table means "nothing visible
// to you matched", same as everywhere else in the app.
async function runSearch(term) {
  const like = `%${term}%`
  const [projects, clients, estimates, bills, entries, expenses] = await Promise.all([
    supabase.from('projects').select('id, code, name').or(`name.ilike.${like},code.ilike.${like}`).limit(5),
    supabase.from('clients').select('id, code, name').or(`name.ilike.${like},code.ilike.${like}`).limit(5),
    supabase.from('estimates').select('id, estimate_number, clients(name)').ilike('estimate_number', like).limit(5),
    supabase.from('bills').select('id, bill_number, clients(name)').ilike('bill_number', like).limit(5),
    supabase.from('job_work_entries').select('id, entry_date, remarks, projects(name)').ilike('remarks', like).limit(5),
    supabase.from('expenses').select('id, expense_date, description, amount').ilike('description', like).limit(5),
  ])
  return {
    projects: projects.data || [],
    clients: clients.data || [],
    estimates: estimates.data || [],
    bills: bills.data || [],
    entries: entries.data || [],
    expenses: expenses.data || [],
  }
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const boxRef = useRef(null)

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults(null)
      return
    }
    setLoading(true)
    const handle = setTimeout(() => {
      runSearch(term.trim()).then((r) => { setResults(r); setLoading(false) })
    }, 250)
    return () => clearTimeout(handle)
  }, [term])

  useEffect(() => {
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function go(path) {
    setOpen(false)
    setTerm('')
    setResults(null)
    navigate(path)
  }

  const hasAny = results && Object.values(results).some((arr) => arr.length > 0)

  return (
    <div className="relative w-full max-w-sm" ref={boxRef}>
      <input
        type="search"
        className="field-input"
        placeholder="Search projects, clients, bills, estimates…"
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true) }}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-1 card p-1 max-h-96 overflow-y-auto z-50 shadow-lg">
          {loading ? (
            <div className="px-3 py-3 text-sm text-ink-500">Searching…</div>
          ) : !hasAny ? (
            <div className="px-3 py-3 text-sm text-ink-500">No matches for "{term}"</div>
          ) : (
            <>
              <SearchGroup label="Projects">
                {results.projects.map((p) => (
                  <SearchRow key={p.id} onClick={() => go(`/projects/${p.id}`)}>
                    <span className="font-medium">{p.name}</span> <span className="text-ink-400 text-xs">{p.code}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
              <SearchGroup label="Clients">
                {results.clients.map((c) => (
                  <SearchRow key={c.id} onClick={() => go('/clients')}>
                    <span className="font-medium">{c.name}</span> <span className="text-ink-400 text-xs">{c.code}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
              <SearchGroup label="Estimates">
                {results.estimates.map((e) => (
                  <SearchRow key={e.id} onClick={() => go(`/estimates/${e.id}`)}>
                    <span className="font-medium">{e.estimate_number}</span> <span className="text-ink-400 text-xs">{e.clients?.name}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
              <SearchGroup label="Bills">
                {results.bills.map((b) => (
                  <SearchRow key={b.id} onClick={() => go(`/billing/${b.id}`)}>
                    <span className="font-medium">{b.bill_number}</span> <span className="text-ink-400 text-xs">{b.clients?.name}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
              <SearchGroup label="Job Entries">
                {results.entries.map((e) => (
                  <SearchRow key={e.id} onClick={() => go(`/daily-log?date=${e.entry_date}`)}>
                    <span className="font-medium">{e.projects?.name}</span> <span className="text-ink-400 text-xs">{displayDate(e.entry_date)} · {e.remarks}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
              <SearchGroup label="Expenses">
                {results.expenses.map((x) => (
                  <SearchRow key={x.id} onClick={() => go(`/daily-log?date=${x.expense_date}`)}>
                    <span className="font-medium">{x.description}</span> <span className="text-ink-400 text-xs">{displayDate(x.expense_date)} · {money(x.amount)}</span>
                  </SearchRow>
                ))}
              </SearchGroup>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SearchGroup({ label, children }) {
  if (!children?.length) return null
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-xs font-semibold text-ink-400 uppercase">{label}</div>
      {children}
    </div>
  )
}

function SearchRow({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-ink-100">
      {children}
    </button>
  )
}
