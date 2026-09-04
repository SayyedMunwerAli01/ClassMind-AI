import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, signInWithGoogle } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { PublicHeader } from '@/components/AppHeader'
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react'

export default function Login() {
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      if (data?.user) {
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', data.user.id)
          .single()

        if (profileData) {
          if (!profileData.is_approved) {
            navigate('/pending')
          } else if (profileData.is_suspended) {
            setError('Your account has been suspended. Please contact the administrator.')
            toastError('Account suspended')
          } else {
            const dashboardPath = profileData.role === 'admin'
              ? '/admin/dashboard'
              : profileData.role === 'teacher'
                ? '/teacher/dashboard'
                : '/student/dashboard'
            navigate(dashboardPath)
          }
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Invalid email or password'
      setError(msg)
      toastError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setGoogleLoading(false)
      setError(googleError)
      toastError(googleError)
    }
    // Success redirects to Google — nothing else to do here
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-navy-dark to-navy flex flex-col relative overflow-hidden">
      {/* Consistent app header */}
      <PublicHeader pageName="Sign In" />

      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="glow-orb w-[420px] h-[420px] -top-40 -right-40 bg-accent-blue/15 animate-blob" />
        <div className="glow-orb w-[360px] h-[360px] bottom-1/4 -left-40 bg-accent-purple/10 animate-blob" style={{ animationDelay: '2s' }} />
      </div>
      <div className="absolute inset-0 grid-pattern pointer-events-none" />

      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-12 relative z-10">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-8 animate-fade-up">
            <h1 className="text-3xl font-bold text-white tracking-tight">Welcome back</h1>
            <p className="text-white/50 mt-2 text-sm">Sign in to continue to ClassMind AI</p>
          </div>

        {/* Form */}
        <form
          onSubmit={handleLogin}
          className="relative bg-white/[0.07] backdrop-blur-xl border border-white/15 rounded-3xl p-6 sm:p-8 space-y-5 animate-fade-up shadow-2xl"
          style={{ animationDelay: '100ms' }}
        >
          {/* Gradient top edge */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-blue/60 to-transparent rounded-t-3xl" />

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            icon={<Mail className="w-5 h-5" />}
            dark
            autoComplete="email"
            required
          />

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="input-field pl-11 pr-11"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/15 text-red-300 p-3.5 rounded-xl text-sm border border-red-500/20 flex items-start gap-2 animate-fade-in">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full" size="lg" variant="gradient">
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight className="w-5 h-5" />}
          </Button>

          {/* Divider */}
          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
            <div className="relative flex justify-center text-[11px] font-medium uppercase tracking-widest">
              <span className="bg-navy px-3 text-white/30" style={{ backgroundColor: 'transparent' }}>or continue with</span>
            </div>
          </div>

          {/* Google */}
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-navy font-semibold text-sm hover:bg-gray-100 active:scale-[0.98] transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {googleLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
            {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
          </button>

          <p className="text-center text-sm text-white/50 pt-1">
            Don't have an account?{' '}
            <Link to="/register" className="text-accent-blue hover:text-accent-purple font-semibold transition-colors">
              Create one here
            </Link>
          </p>
        </form>

        {/* Trust strip */}
        <div className="flex items-center justify-center gap-5 sm:gap-8 mt-7 animate-fade-up" style={{ animationDelay: '200ms' }}>
          <span className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            <Zap className="w-3.5 h-3.5 text-accent-blue" />
            Bilingual AI notes
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-accent-purple" />
            AI tutor 24/7
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Chairman approved
          </span>
        </div>
        </div>
      </div>
    </div>
  )
}
