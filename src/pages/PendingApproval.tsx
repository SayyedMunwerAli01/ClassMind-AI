import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import AppHeader, { UserAvatar } from '@/components/AppHeader'
import { Clock, LogOut, CheckCircle2, Circle, Mail, Radio } from 'lucide-react'

function dashboardPath(role?: string): string {
  switch (role) {
    case 'admin': return '/admin/dashboard'
    case 'teacher': return '/teacher/dashboard'
    case 'student': return '/student/dashboard'
    default: return '/'
  }
}

export default function PendingApproval() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)

  // The instant an admin flips approval, jump straight to the dashboard —
  // no refresh needed (realtime on user_profiles, added in migration 004).
  useEffect(() => {
    if (!user) return

    const checkAndGo = async (approved: boolean) => {
      if (!approved) return
      setChecking(true)
      // Re-read the profile so the guards see the fresh approval
      const { data } = await supabase
        .from('user_profiles')
        .select('is_approved, role')
        .eq('id', user.id)
        .single()
      if (data?.is_approved) {
        navigate(dashboardPath(data.role))
      } else {
        setChecking(false)
      }
    }

    const ch = supabase
      .channel(`pending-approval-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload: any) => { void checkAndGo(!!payload?.new?.is_approved) },
      )
      .subscribe()

    // Safety net: catch an approval that happened while the tab was closed
    void checkAndGo(!!profile?.is_approved)

    return () => { void supabase.removeChannel(ch) }
  }, [user, profile?.is_approved, navigate])

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-navy-dark to-navy flex flex-col relative overflow-hidden">
      {/* Consistent app header — with avatar menu so the user can edit profile / sign out */}
      <AppHeader portalName="Pending Approval" sticky={false} />

      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="glow-orb w-[400px] h-[400px] -top-32 -right-40 bg-accent-blue/10 animate-blob" />
        <div className="glow-orb w-[340px] h-[340px] bottom-1/4 -left-40 bg-accent-purple/10 animate-blob" style={{ animationDelay: '3s' }} />
      </div>
      <div className="absolute inset-0 grid-pattern pointer-events-none" />

      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-12 relative z-10">
      <div className="max-w-md w-full animate-fade-up">

        <div className="relative bg-white/[0.07] backdrop-blur-xl border border-white/15 rounded-3xl p-6 sm:p-10 text-center space-y-6 shadow-2xl">
          {/* Gradient top edge */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent rounded-t-3xl" />

          {/* Status icon — user avatar inside a pulsing waiting ring */}
          <div className="relative w-fit mx-auto">
            <span className="absolute -inset-2 rounded-full border-2 border-amber-400/40 animate-ping" />
            <span className="absolute -inset-2 rounded-full border-2 border-amber-400/20" />
            <UserAvatar
              name={profile?.full_name}
              url={profile?.avatar_url}
              size={84}
              className="ring-4 ring-amber-400/25"
            />
            <span className="absolute -bottom-1 -right-1 w-8 h-8 bg-amber-500 rounded-full border-4 border-navy-dark flex items-center justify-center">
              <Clock className="w-4 h-4 text-white" />
            </span>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 text-[11px] font-bold uppercase tracking-widest border border-amber-500/20 mb-3">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              {checking ? 'Approval received — opening your dashboard' : 'Waiting for approval'}
            </div>
            <h1 className="text-2xl font-bold text-white">Almost there, {profile?.full_name?.split(' ')[0]}!</h1>
            <p className="text-white/50 mt-2 text-sm leading-relaxed">
              Your <span className="font-semibold capitalize text-white/80">{profile?.role}</span> account is awaiting
              approval from the department chairman. This page updates automatically — keep it open.
            </p>
          </div>

          {/* Progress Steps */}
          <div className="bg-white/5 rounded-2xl p-5 text-left space-y-4 border border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-500/15 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">Account Created</p>
                <p className="text-xs text-white/40">Your account has been registered</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-500/15 rounded-full flex items-center justify-center shrink-0 animate-pulse-soft">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">Chairman Review</p>
                <p className="text-xs text-white/40">Waiting for approval verification</p>
              </div>
            </div>
            <div className="flex items-center gap-3 opacity-40">
              <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center shrink-0">
                <Circle className="w-5 h-5 text-white/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">Full Access</p>
                <p className="text-xs text-white/40">Your dashboard unlocks after approval</p>
              </div>
            </div>
          </div>

          <div className="bg-accent-blue/10 rounded-xl p-3.5 flex items-start gap-2.5 border border-accent-blue/15">
            <Mail className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
            <p className="text-xs text-white/50 leading-relaxed">
              This usually takes 1-2 business days. You can also sign out now and come back later.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button onClick={signOut} variant="dark" className="flex-1">
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
            <Button onClick={() => navigate('/')} variant="secondary" className="flex-1">
              Back to Home
            </Button>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
