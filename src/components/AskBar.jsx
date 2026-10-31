import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Top-of-page assistant. Answers questions from live data; the server enforces what this user
// may see. Read-only for now: entering, changing and deleting through the bar comes next, with
// an approval step before anything is saved.
export default function AskBar() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [busy, setBusy] = useState(false)

  async function ask(e) {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setBusy(true)
    setAnswer(null)
    const { data, error } = await supabase.functions.invoke('assistant-query', { body: { question: q } })
    setBusy(false)
    setAnswer(error ? `Could not answer: ${error.message}` : (data?.answer || data?.error || 'No answer.'))
  }

  return (
    <div className="relative w-full">
      <form onSubmit={ask}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything: 'what did we spend on Aadhi Villa this month?'"
          className="field-input w-full"
          aria-label="Ask the assistant"
        />
      </form>
      {(busy || answer) && (
        <div className="absolute left-0 right-0 mt-1 card p-3 text-sm text-ink-800 z-40 whitespace-pre-wrap">
          {busy ? 'Thinking…' : answer}
          {!busy && <button className="block text-xs text-ink-500 mt-2 hover:underline" onClick={() => setAnswer(null)}>Close</button>}
        </div>
      )}
    </div>
  )
}
