import { useCallback, useEffect, useState } from 'react'
import { supabase, configured, friendlyError } from './lib/supabase'
import Brand from './components/Brand'
import Desk from './components/Desk'

function Gate({ title, children }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <Brand />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'forgot' | 'sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(/invalid login/i.test(error.message) ? 'Wrong email or password.' : friendlyError(error))
  }
  async function sendReset(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/' })
    setBusy(false)
    if (error) setErr(/rate limit/i.test(error.message) ? 'Too many reset emails. Wait a few minutes and try again.' : friendlyError(error))
    else setMode('sent')
  }
  const toSignIn = () => { setMode('signin'); setErr('') }

  if (mode === 'sent') {
    return (
      <Gate title="Check your email">
        <p>If <b>{email.trim()}</b> has a login, a reset link is on its way. Open it on this device to set a new password.</p>
        <button className="btn" type="button" onClick={toSignIn}>Back to sign in</button>
      </Gate>
    )
  }
  if (mode === 'forgot') {
    return (
      <Gate title="Reset your password">
        <p>Enter your login email and we'll send you a link to set a new password.</p>
        <form onSubmit={sendReset}>
          <label>Email<input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <button className="btn ghost" type="button" onClick={toSignIn}>Back to sign in</button>
        </form>
      </Gate>
    )
  }
  return (
    <Gate title="Sign in">
      <p>Use the login your admin created for you.</p>
      <form onSubmit={submit}>
        <label>Email<input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="btn ghost" type="button" onClick={() => { setMode('forgot'); setErr('') }}>Forgot password?</button>
      </form>
    </Gate>
  )
}

// Opened from a password-reset email: Supabase has signed the user in for recovery only.
function SetNewPassword({ onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr("The two passwords don't match.")
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setErr(friendlyError(error))
    else onDone()
  }
  return (
    <Gate title="Set a new password">
      <p>Choose a new password. If you also use Formgrid Factory, it changes there too.</p>
      <form onSubmit={submit}>
        <label>New password<input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <label>Repeat it<input className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </Gate>
  )
}

// Signed in, but not (yet) on the lead desk team.
function NoAccess({ email, needsSetup, onClaimed }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function claim() {
    setBusy(true)
    const { data, error } = await supabase.rpc('claim_first_admin')
    setBusy(false)
    if (error) setErr(friendlyError(error))
    else if (data) onClaimed()
    else setErr('Someone already set up the lead desk. Ask them to add you.')
  }
  return (
    <Gate title={needsSetup ? 'Set up the lead desk' : 'No access yet'}>
      {needsSetup ? (
        <>
          <p>The lead desk has no team yet. If you're a Formgrid admin, you can become its first admin and then add your sales team.</p>
          {err && <p className="err">{err}</p>}
          <div className="actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" type="button" onClick={claim} disabled={busy}>Become lead desk admin</button>
            <button className="btn" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </>
      ) : (
        <>
          <p><b>{email}</b> isn't on the lead desk team. Ask a lead desk admin to add you in Settings → Team.</p>
          <button className="btn" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </>
      )}
    </Gate>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [member, setMember] = useState(undefined)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [err, setErr] = useState('')
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      // Token refreshes don't change who is signed in; avoid re-checking membership.
      if (event === 'TOKEN_REFRESHED') return
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  const loadMember = useCallback(async () => {
    if (!userId) { setMember(null); return }
    setMember(undefined)
    setErr('')
    const { data, error } = await supabase.from('members').select('user_id,display_name,role,active').eq('user_id', userId).maybeSingle()
    if (error) { setErr(friendlyError(error)); return }
    if (!data?.active) {
      const { data: ns } = await supabase.rpc('needs_setup')
      setNeedsSetup(Boolean(ns))
    }
    setMember(data?.active ? data : null)
  }, [userId])

  // Keyed on the user id, not the session object: Supabase re-emits SIGNED_IN on tab focus,
  // and re-checking membership then would unmount the desk mid-edit.
  const sessionKnown = session !== undefined
  useEffect(() => { if (sessionKnown) loadMember() }, [sessionKnown, loadMember])

  if (!configured) {
    return <Gate title="Not configured"><p>Copy <code>.env.example</code> to <code>.env</code> and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.</p></Gate>
  }
  if (recovering && session) return <SetNewPassword onDone={() => setRecovering(false)} />
  if (err) {
    return (
      <Gate title="Can't load the lead desk">
        <p className="err">{err}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" type="button" onClick={loadMember}>Try again</button>
          <button className="btn" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </Gate>
    )
  }
  if (session === undefined || (session && member === undefined)) return <div className="loading">Loading…</div>
  if (!session) return <Login />
  if (!member) return <NoAccess email={session.user.email} needsSetup={needsSetup} onClaimed={loadMember} />
  return <Desk me={member} email={session.user.email} />
}
