import { useEffect, useState, createContext, useContext, useCallback } from 'react'
import { pct } from '../lib/progress'

export function Bar({ value, large }) {
  return <div className={`bar${large ? ' bar-lg' : ''}`} role="progressbar" aria-valuenow={Math.round((value || 0) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct(value) }} /></div>
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head"><h2>{title}</h2><span className="spacer" /><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [t, setT] = useState(null)
  const show = useCallback((message, bad) => { setT({ message, bad, k: Date.now() }) }, [])
  useEffect(() => {
    if (!t) return
    const id = setTimeout(() => setT(null), t.bad ? 6000 : 2600)
    return () => clearTimeout(id)
  }, [t])
  return <ToastCtx.Provider value={show}>{children}{t && <div key={t.k} className={`toast${t.bad ? ' bad' : ''}`} role="status">{t.message}</div>}</ToastCtx.Provider>
}

export const Empty = ({ children }) => <div className="empty">{children}</div>
export const Loading = () => <div className="empty">Loading…</div>

// Runs an async action, toasts any failure, returns whether it worked.
export function useAction() {
  const toast = useToast()
  return useCallback(async (fn, okMessage) => {
    try { const r = await fn(); if (okMessage) toast(okMessage); return r ?? true } catch (e) { toast(e.message || 'Something went wrong', true); return false }
  }, [toast])
}
