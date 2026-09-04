import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function useTeacherGuard() {
  const { user, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/login'); return }
    if (profile?.role !== 'teacher') { navigate('/'); return }
    if (!profile?.is_approved) { navigate('/pending'); return }
    if (profile?.is_suspended) { navigate('/login'); return }
    setVerified(true)
  }, [user, profile, loading, navigate])

  return { verified, user, profile }
}