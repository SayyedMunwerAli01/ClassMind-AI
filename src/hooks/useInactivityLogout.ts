import { useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/ui/Toast'

/**
 * Auto-logout after 15 minutes of user inactivity.
 *
 * - Tracks mouse, keyboard, touch, and scroll events to detect activity.
 * - Shows a warning toast 2 minutes before logout.
 * - Skips the timer while any page element signals `data-recording="true"`
 *   (e.g. the teacher's live recording panel) so lectures are never interrupted.
 *
 * Usage: call `useInactivityLogout()` once inside `<App />`.
 */

const IDLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000 // warn 2 min before
const CHECK_INTERVAL_MS = 30_000         // check every 30 seconds

export function useInactivityLogout() {
  const { user, signOut } = useAuth()
  const { warning } = useToast()
  const lastActivityRef = useRef(Date.now())
  const warnedRef = useRef(false)

  // Reset the idle clock on any user interaction
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    warnedRef.current = false
  }, [])

  useEffect(() => {
    if (!user) return // only for authenticated users

    // Listen for user activity signals
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const
    for (const evt of events) {
      document.addEventListener(evt, handleActivity, { passive: true })
    }

    // Periodically check idle time
    const interval = setInterval(() => {
      // Skip check if the page signals active recording
      const recordingEl = document.querySelector('[data-recording="true"]')
      if (recordingEl) {
        lastActivityRef.current = Date.now() // keep alive during recording
        warnedRef.current = false
        return
      }

      const idle = Date.now() - lastActivityRef.current
      const remaining = IDLE_TIMEOUT_MS - idle

      // Warn 2 minutes before
      if (remaining <= WARNING_BEFORE_MS && remaining > 0 && !warnedRef.current) {
        warnedRef.current = true
        const mins = Math.ceil(remaining / 60_000)
        warning(`You'll be signed out in ${mins} minute${mins !== 1 ? 's' : ''} due to inactivity`)
      }

      // Force logout
      if (remaining <= 0) {
        void signOut()
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      for (const evt of events) {
        document.removeEventListener(evt, handleActivity)
      }
      clearInterval(interval)
    }
  }, [user, handleActivity, signOut, warning])
}
