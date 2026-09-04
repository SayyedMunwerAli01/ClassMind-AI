import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function useAdminGuard() {
  const { user, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/login'); return }
    if (profile?.role !== 'admin') { navigate('/'); return }
    setVerified(true)
  }, [user, profile, loading, navigate])

  return { verified, user, profile }
}