import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)
  const t = useRef()
  const toast = useCallback((m) => {
    setMsg(m)
    setShow(true)
    clearTimeout(t.current)
    t.current = setTimeout(() => setShow(false), 2800)
  }, [])
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={'toast' + (show ? ' show' : '')} role="status" aria-live="polite">{msg}</div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
