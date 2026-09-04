import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function useStudentGuard() {
  const { user, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [verified, setVerified] = useState(false)
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState<string[]>([])

  useEffect(() => {
    if (loading) return

    if (!user) {
      navigate('/login')
      return
    }

    if (profile?.role !== 'student') {
      navigate('/')
      return
    }

    if (!profile?.is_approved) {
      navigate('/pending')
      return
    }

    if (profile?.is_suspended) {
      navigate('/login')
      return
    }

    setVerified(true)
  }, [user, profile, loading, navigate])

  return { verified, user, profile, enrolledSubjectIds, setEnrolledSubjectIds }
}