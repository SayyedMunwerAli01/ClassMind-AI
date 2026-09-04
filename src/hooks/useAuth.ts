import { useState, useEffect, useCallback } from 'react'
import { supabase, fetchUserProfile } from '@/lib/supabase'
import type { UserProfile } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const prof = await fetchUserProfile(session.user.id)
        setProfile(prof)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    // Initial check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const prof = await fetchUserProfile(session.user.id)
        setProfile(prof)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  // Re-fetch the profile after the user edits their name / avatar
  const refreshProfile = useCallback(async () => {
    if (!user) return
    const prof = await fetchUserProfile(user.id)
    setProfile(prof)
  }, [user])

  return { user, profile, loading, signOut, refreshProfile }
}