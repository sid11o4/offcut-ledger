import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [loadingProfile, setLoadingProfile] = useState(false)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setPermissions({})
      return
    }
    setLoadingProfile(true)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('id, full_name, active, phone, role_id, roles ( id, key, name )')
      .eq('id', userId)
      .maybeSingle()

    setProfile(profileRow || null)

    if (profileRow?.role_id) {
      const { data: perms } = await supabase
        .from('role_permissions')
        .select('permission_key, allowed')
        .eq('role_id', profileRow.role_id)
      const map = {}
      for (const p of perms || []) map[p.permission_key] = p.allowed
      setPermissions(map)
    } else {
      setPermissions({})
    }
    setLoadingProfile(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      if (data.session?.user?.id) loadProfile(data.session.user.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      if (sess?.user?.id) loadProfile(sess.user.id)
      else {
        setProfile(null)
        setPermissions({})
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const hasPermission = useCallback((key) => Boolean(permissions[key]), [permissions])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    roleKey: profile?.roles?.key ?? null,
    roleName: profile?.roles?.name ?? null,
    permissions,
    hasPermission,
    loading: session === undefined || loadingProfile,
    signIn,
    signOut,
    refreshProfile: () => session?.user?.id && loadProfile(session.user.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
