import { createContext, useCallback, useContext, useState } from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { message, detail, tone, resolve }

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({ message, detail: opts.detail, tone: opts.tone || 'danger', confirmLabel: opts.confirmLabel || 'Confirm', resolve })
    })
  }, [])

  const handle = (result) => {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card p-5 w-full max-w-sm">
            <div className="text-sm font-semibold text-ink-900">{state.message}</div>
            {state.detail && <div className="text-sm text-ink-500 mt-2">{state.detail}</div>}
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn-secondary" onClick={() => handle(false)}>Cancel</button>
              <button
                className={state.tone === 'danger' ? 'btn-danger' : 'btn-primary'}
                onClick={() => handle(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
