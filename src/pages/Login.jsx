import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-lg font-semibold text-brand-700">Formgrid Factory</div>
          <div className="text-xs text-ink-500">Job-work, billing &amp; financial management</div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-bad text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="field-label">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input"
              autoComplete="current-password"
            />
          </div>
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full mt-5">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
