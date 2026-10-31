import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)
let idSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((message, tone = 'ok') => {
    const id = ++idSeq
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => dismiss(id), 5000)
  }, [dismiss])

  const api = {
    success: (m) => push(m, 'ok'),
    error: (m) => push(m, 'bad'),
    info: (m) => push(m, 'neutral'),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[90vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => dismiss(t.id)}
            className={`toast-in cursor-pointer rounded-lg border px-4 py-3 text-sm shadow-[0_12px_32px_-12px_rgba(10,10,10,0.28)] ${
              t.tone === 'ok'
                ? 'bg-green-50 border-green-200 text-ok'
                : t.tone === 'bad'
                ? 'bg-red-50 border-red-200 text-bad'
                : 'bg-white border-ink-200 text-ink-800'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
