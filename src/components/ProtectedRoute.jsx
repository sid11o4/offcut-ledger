import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LoadingBlock } from './ui'

export function ProtectedRoute({ children }) {
  const { session, loading, profile } = useAuth()

  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingBlock /></div>
  if (!session) return <Navigate to="/login" replace />
  if (profile && !profile.active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <div className="text-lg font-semibold text-ink-900">Your account is inactive</div>
          <p className="text-sm text-ink-500 mt-2">Ask an administrator to reactivate your account.</p>
        </div>
      </div>
    )
  }
  return children
}

export function RequirePermission({ perm, children }) {
  const { hasPermission } = useAuth()
  if (!hasPermission(perm)) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm font-semibold text-ink-900">You don't have access to this page</div>
        <p className="text-xs text-ink-500 mt-1">Ask an administrator to grant the required permission.</p>
      </div>
    )
  }
  return children
}
