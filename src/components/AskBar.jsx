import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// One input: type a question, or attach a photo/PDF of a bill and ask about it. Answers come
// back as a summary, supporting tables with links into the app, and suggested follow-ups.
// Read-only for now; creating, changing and deleting through the bar will come next, behind an
// approval step.

const MAX_BYTES = 4 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function AskBar() {
  const [question, setQuestion] = useState('')
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_BYTES) { setError('That file is over 4 MB. Attach a smaller photo or PDF.'); return }
    setFile(f)
    setError(null)
  }

  async function ask(e, overrideQuestion) {
    e?.preventDefault()
    const q = (overrideQuestion ?? question).trim()
    if (!q && !file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const body = { question: q }
      if (file) body.attachment = { mime: file.type, base64: await readAsBase64(file) }
      const { data, error: fnError } = await supabase.functions.invoke('assistant-query', { body })
      if (fnError) throw new Error(fnError.message)
      if (data?.error) throw new Error(data.error)
      setResult(data.answer)
    } catch (err) {
      setError(err.message || 'Could not get an answer.')
    } finally {
      setBusy(false)
    }
  }

  function followUp(text) {
    setQuestion(text)
    ask(null, text)
  }

  function close() {
    setResult(null)
    setError(null)
  }

  const showPanel = busy || result || error

  return (
    <div className="relative w-full">
      <form onSubmit={ask} className="flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={file ? 'Ask about this file, or press Enter' : 'Ask anything, or attach a bill'}
          className="field-input flex-1 min-w-0"
          aria-label="Ask the assistant"
        />
        <button type="button" className="btn-ghost px-2 shrink-0" onClick={() => fileRef.current?.click()} aria-label="Attach a bill or photo" title="Attach a bill or photo">
          ⌗
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={pickFile} />
      </form>
      {file && (
        <div className="mt-1 text-xs text-ink-600 flex items-center gap-2">
          <span className="truncate">Attached: {file.name}</span>
          <button className="text-ink-500 hover:underline" onClick={() => setFile(null)}>Remove</button>
        </div>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 mt-2 card p-4 text-sm text-ink-800 z-40 max-h-[70vh] overflow-y-auto shadow-none">
          {busy && <div className="text-ink-500">Working on it…</div>}
          {error && <div className="text-bad">{error}</div>}
          {result && (
            <>
              <p className="text-base text-ink-950 leading-relaxed">{result.summary}</p>
              {result.not_permitted && (
                <p className="mt-2 text-xs text-warn">Part of this answer is hidden because your account does not have access to it.</p>
              )}
              {(result.sections || []).map((s, i) => (
                <div key={i} className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-ink-600 uppercase tracking-wide">{s.title}</div>
                    {s.link && <Link to={s.link} onClick={close} className="text-xs text-brand-700 hover:underline">Open →</Link>}
                  </div>
                  <div className="overflow-x-auto mt-1">
                    <table className="table-base">
                      <thead><tr>{s.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                      <tbody>
                        {s.rows.map((row, r) => (
                          <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {result.follow_ups?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {result.follow_ups.map((f, i) => (
                    <button key={i} className="btn-ghost text-xs border border-ink-200 rounded-full px-3 py-1" onClick={() => followUp(f)}>{f}</button>
                  ))}
                </div>
              )}
            </>
          )}
          {!busy && (result || error) && (
            <button className="block text-xs text-ink-500 mt-4 hover:underline" onClick={close}>Close</button>
          )}
        </div>
      )}
    </div>
  )
}
