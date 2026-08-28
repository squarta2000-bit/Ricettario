import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth()
  if (isLoading) return null
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
