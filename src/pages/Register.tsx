import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, signInWithGoogle } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { PublicHeader } from '@/components/AppHeader'
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, BookOpen, Users, Shield, GraduationCap } from 'lucide-react'
import type { UserRole } from '@/lib/types'
import { clsx } from 'clsx'

const PENDING_ROLE_KEY = 'classmind_pending_role'

export default function Register() {
  const navigate = useNavigate()
  const { success: toastSuccess, error: toastError } = useToast()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('student')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')

  const roleIcons: Record<UserRole, React.ReactNode> = {
    student: <BookOpen className="w-5 h-5" />,
    teacher: <Users className="w-5 h-5" />,
    admin: <Shield className="w-5 h-5" />,
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      toastError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      toastError('Password too short')
      return
    }

    setLoading(true)

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: role,
          },
        },
      })

      if (signUpError) throw signUpError

      toastSuccess('Account created! Awaiting approval.')
      navigate('/pending')
    } catch (err: any) {
      const msg = err.message || 'Registration failed'
      setError(msg)
      toastError(msg)
    } finally {
      setLoading(false)
    }
  }

  // Google can't carry form data through the redirect — remember the chosen
  // role and apply it right after the user lands back (see App.tsx + migration 005)
  const handleGoogle = async () => {
    setGoogleLoading(true)
    localStorage.setItem(PENDING_ROLE_KEY, role === 'admin' ? 'student' : role)
    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      localStorage.removeItem(PENDING_ROLE_KEY)
      setGoogleLoading(false)
      setError(googleError)
      toastError(googleError)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-navy-dark to-navy flex flex-col relative overflow-hidden">
      {/* Consistent app header */}
      <PublicHeader pageName="Create Account" />

      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="glow-orb w-[420px] h-[420px] -top-32 -left-40 bg-accent-purple/12 animate-blob" />
        <div className="glow-orb w-[380px] h-[380px] bottom-1/4 -right-40 bg-accent-blue/12 animate-blob" style={{ animationDelay: '2s' }} />
      </div>
      <div className="absolute inset-0 grid-pattern pointer-events-none" />

      <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-10 relative z-10">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-8 animate-fade-up">
            <h1 className="text-3xl font-bold text-white tracking-tight">Create your account</h1>
            <p className="text-white/50 mt-2 text-sm">Join ClassMind AI </p>
          </div>

        {/* Form */}
        <form
          onSubmit={handleRegister}
          className="relative bg-white/[0.07] backdrop-blur-xl border border-white/15 rounded-3xl p-6 sm:p-8 space-y-5 animate-fade-up shadow-2xl"
          style={{ animationDelay: '100ms' }}
        >
          {/* Gradient top edge */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-purple/60 to-transparent rounded-t-3xl" />

          <Input
            label="Full Name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            icon={<User className="w-5 h-5" />}
            dark
            autoComplete="name"
            required
          />

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
                placeholder="Min. 6 characters"
                autoComplete="new-password"
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

          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                className="input-field pl-11"
                required
              />
            </div>
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-2">I am a...</label>
            <div className="grid grid-cols-3 gap-2">
              {(['student', 'teacher', 'admin'] as UserRole[]).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl font-semibold text-sm transition-all duration-200 capitalize border-2',
                    role === r
                      ? 'bg-accent-blue text-white border-accent-blue shadow-lg shadow-accent-blue/20'
                      : 'bg-white/10 text-white/70 border-white/10 hover:bg-white/15 hover:border-white/20',
                  )}
                >
                  <span className={clsx(role === r ? 'text-white/80' : 'text-white/50')}>
                    {roleIcons[r]}
                  </span>
                  {r}
                </button>
              ))}
            </div>
            {role === 'admin' && (
              <p className="text-xs text-amber-300 mt-2.5 flex items-start gap-1.5 bg-amber-500/15 p-2.5 rounded-lg border border-amber-500/20">
                <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Admin accounts require special verification from the chairman.
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-500/15 text-red-300 p-3.5 rounded-xl text-sm border border-red-500/20 flex items-start gap-2 animate-fade-in">
              <Shield className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full" size="lg" variant="gradient">
            {loading ? 'Creating Account...' : 'Create Account'}
            {!loading && <ArrowRight className="w-5 h-5" />}
          </Button>

          {/* Divider */}
          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
            <div className="relative flex justify-center text-[11px] font-medium uppercase tracking-widest">
              <span className="px-3 text-white/30" style={{ backgroundColor: 'transparent' }}>or sign up with</span>
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
            {googleLoading ? 'Redirecting to Google...' : 'Sign up with Google'}
          </button>
          <p className="text-center text-[11px] text-white/35 -mt-2 flex items-center justify-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" />
            Google accounts join as the role you picked above
          </p>

          <p className="text-center text-sm text-white/50 pt-1">
            Already have an account?{' '}
            <Link to="/login" className="text-accent-blue hover:text-accent-purple font-semibold transition-colors">
              Sign in here
            </Link>
          </p>
        </form>

        {/* Trust note */}
        <p className="text-center text-[11px] text-white/30 mt-6 animate-fade-up" style={{ animationDelay: '200ms' }}>
          Free for all UoS students &middot; Approved by the department chairman
        </p>
        </div>
      </div>
    </div>
  )
}
