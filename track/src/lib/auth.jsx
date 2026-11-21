import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [role, setRole] = useState(null)             // 'admin' | 'site_team' | 'none'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setRole(null); return }
    let live = true
    supabase.rpc('track_role').then(({ data }) => { if (live) setRole(data || 'none') })
    return () => { live = false }
  }, [session])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }, [])
  const signOut = useCallback(() => supabase.auth.signOut(), [])

  return <Ctx.Provider value={{ session, user: session?.user, role, isAdmin: role === 'admin', signIn, signOut }}>{children}</Ctx.Provider>
}
