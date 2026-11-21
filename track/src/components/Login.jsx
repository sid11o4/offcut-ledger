import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { Field } from './ui'
import { configured } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await signIn(email.trim(), password) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div><h1 className="brand">FORMGRID <span>Track</span></h1><p className="muted small" style={{ margin: '4px 0 0' }}>Site progress, daily reports and material requests.</p></div>
        {!configured && <div className="notice">Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div>}
        <Field label="Email"><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="notice" role="alert" style={{ background: 'var(--bad-bg)', color: '#831c1e' }}>{error}</div>}
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
