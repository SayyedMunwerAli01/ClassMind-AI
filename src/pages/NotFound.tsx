import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { ArrowLeft, Home, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-navy-dark to-navy flex flex-col relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="glow-orb w-[400px] h-[400px] -top-32 -right-40 bg-accent-blue/10 animate-blob" />
        <div className="glow-orb w-[340px] h-[340px] bottom-1/4 -left-40 bg-accent-purple/10 animate-blob" style={{ animationDelay: '3s' }} />
      </div>
      <div className="absolute inset-0 grid-pattern pointer-events-none" />

      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-12 relative z-10">
        <div className="max-w-md w-full text-center animate-fade-up">

          {/* Big 404 number */}
          <div className="mb-6">
            <span className="text-[8rem] sm:text-[10rem] font-black leading-none text-transparent bg-clip-text bg-gradient-to-b from-white/20 to-white/5 select-none">
              404
            </span>
          </div>

          {/* Logo + message */}
          <div className="mb-8">
            <div className="mx-auto mb-5">
              <Logo size={56} glow />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Page not found
            </h1>
            <p className="text-white/40 text-sm leading-relaxed max-w-sm mx-auto">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
              Let&apos;s get you back on track.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/">
              <Button size="lg" variant="gradient" className="w-full sm:w-auto shadow-2xl shadow-accent-blue/20">
                <Home className="w-4 h-4" />
                Go Home
              </Button>
            </Link>
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white/60 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          </div>

          {/* Helpful links */}
          <div className="mt-12 pt-8 border-t border-white/[0.06]">
            <p className="text-white/20 text-xs font-semibold uppercase tracking-widest mb-4">Quick Links</p>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                { to: '/login', label: 'Sign In' },
                { to: '/register', label: 'Create Account' },
                { to: '/', label: 'Landing Page' },
              ].map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-xs font-medium text-white/30 hover:text-accent-blue bg-white/[0.03] hover:bg-white/[0.06] px-4 py-2 rounded-xl border border-white/[0.05] transition-all"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
