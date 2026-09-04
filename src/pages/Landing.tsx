import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import type { MouseEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/Logo'
import { Reveal } from '@/components/Reveal'
import {
  Mic, FileText, Brain, MessageCircle, Shield,
  GraduationCap, Sparkles, ArrowRight, Zap, Globe,
  ChevronRight, Play, Star, Clock, Users,
  BarChart3, Languages, Lock, Cpu, CheckCircle2,
} from 'lucide-react'

const TECH_STACK = ['Groq Whisper', 'Google Gemini', 'Supabase', 'React', 'TypeScript', 'Tailwind CSS', 'Vite']

export default function Landing() {
  // Premium cursor-follow glow: bento cards expose --mouse-x/--mouse-y CSS vars
  const handleBentoMove = (e: MouseEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest('.bento-card') as HTMLElement | null
    if (!card) return
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }

  // Paint the browser canvas (behind the page) dark while the landing page is
  // open. The body's near-white background would otherwise flash through during
  // fast scrolling whenever the compositor briefly drops the page layer.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.backgroundColor
    root.style.backgroundColor = '#151B45'
    return () => { root.style.backgroundColor = previous }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-dark via-navy to-navy-dark relative overflow-hidden noise-overlay">

      {/* ===== Ambient effects (fixed — the big blurred glows stay perfectly
           still behind the content, so fast scrolling never re-rasterizes them) ===== */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="glow-orb w-[500px] h-[500px] -top-40 -right-40 bg-accent-blue/20 animate-blob" />
        <div className="glow-orb w-[400px] h-[400px] top-1/3 -left-48 bg-accent-purple/15 animate-blob" style={{ animationDelay: '2s' }} />
        <div className="glow-orb w-[350px] h-[350px] bottom-1/4 right-1/4 bg-accent-blue/10 animate-blob" style={{ animationDelay: '4s' }} />
        {/* Soft spotlight from the top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-gradient-to-b from-accent-blue/[0.08] via-transparent to-transparent blur-2xl" />
      </div>
      {/* Grid lines — also fixed, so the tiled background never repaints
           while the content scrolls over it */}
      <div className="fixed inset-0 grid-pattern pointer-events-none" />

      {/* ===== Sticky Navigation ===== */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-navy-dark/75 border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand — name always visible, even on the smallest screens (matches the app header) */}
          <Link to="/" className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
            <Logo size={40} glow />
            <div className="min-w-0">
              <span className="block font-bold text-white text-sm tracking-tight truncate">ClassMind AI</span>
              <p className="hidden sm:block text-[10px] text-white/30 font-medium -mt-0.5 tracking-widest uppercase">University of Sindh</p>
            </div>
          </Link>

          {/* Anchor links */}
          <div className="hidden md:flex items-center gap-7">
            <a href="#features" className="text-sm font-medium text-white/50 hover:text-white transition-colors">Features</a>
            <a href="#how" className="text-sm font-medium text-white/50 hover:text-white transition-colors">How it works</a>
            <a href="#testimonials" className="text-sm font-medium text-white/50 hover:text-white transition-colors">Reviews</a>
          </div>

          {/* CTAs — compact on phones so the brand never gets squeezed out */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-2 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-accent-blue to-accent-purple text-white shadow-lg shadow-accent-blue/20 hover:shadow-xl hover:shadow-accent-blue/25 transition-all duration-200 active:scale-[0.97]"
            >
              Get Started
              <ArrowRight className="hidden sm:block w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ===== HERO SECTION ===== */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-16 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-8 items-center">

          {/* Left: Copy */}
          <div className="space-y-8">
            {/* Announcement pill */}
            <div className="animate-text-reveal">
              <div className="inline-flex items-center gap-2 bg-accent-blue/10 text-accent-blue px-4 py-1.5 rounded-full text-xs font-semibold border border-accent-blue/20 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                Now with Gemini AI &mdash; Urdu &amp; English notes
              </div>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-[3.75rem] font-black text-white leading-[1.08] tracking-tight">
              <span className="animate-text-reveal block" style={{ animationDelay: '0.15s' }}>Every Lecture.</span>
              <span className="animate-text-reveal block mt-1" style={{ animationDelay: '0.3s' }}>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-blue via-accent-purple to-accent-blue bg-[length:200%_200%] animate-gradient">
                  Perfectly Captured.
                </span>
              </span>
              <span className="animate-text-reveal block text-white/70 text-3xl sm:text-4xl lg:text-5xl mt-3 font-bold" style={{ animationDelay: '0.45s' }}>
                Instantly understood.
              </span>
            </h1>

            {/* Sub-headline */}
            <p className="text-base sm:text-lg text-white/50 leading-relaxed max-w-lg animate-text-reveal" style={{ animationDelay: '0.55s' }}>
              ClassMind AI transcribes your lectures in real-time, generates bilingual study notes,
              creates smart quizzes, and gives you an AI tutor that knows <em className="text-white/70 not-italic font-medium">exactly</em> what was taught.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-3 animate-text-reveal" style={{ animationDelay: '0.65s' }}>
              <Link to="/register">
                <Button size="lg" variant="gradient" className="shadow-2xl shadow-accent-blue/20 hover:shadow-accent-blue/40 transition-shadow">
                  Start Learning Free
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="dark" className="gap-2.5">
                  <Play className="w-4 h-4" />
                  See How It Works
                </Button>
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-6 pt-2 animate-text-reveal" style={{ animationDelay: '0.75s' }}>
              <div className="flex -space-x-2">
                {['bg-accent-blue', 'bg-accent-purple', 'bg-emerald-500', 'bg-amber-500'].map((bg, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full ${bg} border-2 border-navy-dark flex items-center justify-center`}>
                    <span className="text-[10px] font-bold text-white">{['AK', 'SF', 'MR', 'ZN'][i]}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Trusted by students across UoS departments</p>
              </div>
            </div>
          </div>

          {/* Right: Floating Dashboard Mockup (visible on every screen size) */}
          <div className="relative mt-2 lg:mt-0 animate-text-reveal" style={{ animationDelay: '0.4s' }}>
            {/* Ambient glow behind mockup — promoted to its own layer so it
                never rasterizes mid-scroll */}
            <div className="absolute -inset-10 bg-gradient-to-br from-accent-blue/20 via-accent-purple/10 to-transparent rounded-full blur-3xl will-change-transform pointer-events-none" />

            <div className="relative">
              <div className="mock-card">
                {/* Mockup header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <Logo size={32} glow />
                    <div>
                      <p className="text-white text-xs font-semibold">Student Dashboard</p>
                      <p className="text-white/30 text-[10px]">3 subjects enrolled</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-400/60" />
                    <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    <div className="w-2 h-2 rounded-full bg-emerald-400/60" />
                  </div>
                </div>

                {/* Mockup stats row */}
                <div className="grid grid-cols-3 gap-2.5 mb-4">
                  {[
                    { label: 'Notes', value: '47', icon: FileText, color: 'from-blue-500 to-blue-600' },
                    { label: 'Quizzes', value: '12', icon: Brain, color: 'from-purple-500 to-purple-600' },
                    { label: 'To-Dos', value: '8', icon: CheckCircle2, color: 'from-emerald-500 to-emerald-600' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-white/[0.04] rounded-xl p-3 border border-white/[0.04]">
                      <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center mb-2`}>
                        <stat.icon className="w-3 h-3 text-white" />
                      </div>
                      <p className="text-white text-lg font-bold leading-none">{stat.value}</p>
                      <p className="text-white/30 text-[10px] mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Mockup subject list */}
                <div className="space-y-2">
                  {['Operating Systems', 'Database Systems', 'Computer Networks'].map((name, i) => (
                    <div key={name} className="flex items-center gap-3 bg-white/[0.03] rounded-xl p-2.5 border border-white/[0.03]">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold ${
                        ['bg-blue-500/20', 'bg-emerald-500/20', 'bg-purple-500/20'][i]
                      }`}>
                        {name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium truncate">{name}</p>
                        <p className="text-white/25 text-[10px]">{[18, 14, 11][i]} notes</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-white/20" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Floating AI tutor card (desktop only — keeps mobile clutter-free) */}
              <div className="absolute -bottom-6 -left-6 mock-card !p-3 animate-float w-48 hidden lg:block">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-white text-[10px] font-semibold">AI Tutor</span>
                </div>
                <p className="text-white/50 text-[10px] leading-snug">Explain semaphores in OS with a real-world example...</p>
              </div>

              {/* Floating stats badge */}
              <div className="absolute -top-4 -right-4 mock-card !p-3 animate-float-delayed hidden lg:block">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-emerald-400 text-sm font-bold">98%</p>
                    <p className="text-white/30 text-[9px]">Quiz Score</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TRUST STRIP (infinite marquee) ===== */}
      <section className="relative z-10 border-y border-white/[0.04] bg-white/[0.02] py-7 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <Reveal>
            <p className="text-center text-white/20 text-[11px] font-medium uppercase tracking-[0.25em] mb-5">
              Powering education with
            </p>
            <div className="marquee-mask">
              <div className="flex w-max animate-marquee items-center gap-14">
                {[...TECH_STACK, ...TECH_STACK].map((tech, i) => (
                  <span key={i} className="flex items-center gap-2.5 text-white/30 text-sm font-semibold tracking-wide whitespace-nowrap">
                    <span className="w-1 h-1 rounded-full bg-accent-blue/40" />
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-6">
          {[
            { value: '3x', label: 'Faster note creation', icon: Zap },
            { value: '100%', label: 'Bilingual coverage', icon: Globe },
            { value: '24/7', label: 'AI tutor access', icon: Clock },
            { value: '3', label: 'Role dashboards', icon: Users },
          ].map((stat, i) => (
            <Reveal key={stat.label} delay={i * 90}>
              <div className="text-center group">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4 group-hover:bg-accent-blue/10 group-hover:border-accent-blue/20 transition-all duration-300">
                  <stat.icon className="w-5 h-5 text-accent-blue" />
                </div>
                <p className="counter-number text-3xl sm:text-4xl font-black">{stat.value}</p>
                <p className="text-white/35 text-sm mt-1 font-medium">{stat.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===== BENTO FEATURES ===== */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pb-24 scroll-mt-20">
        <Reveal className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-accent-purple/10 text-accent-purple px-4 py-1.5 rounded-full text-xs font-semibold border border-accent-purple/20 mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            Powerful Features
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
            One platform for your
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-blue to-accent-purple">
              entire academic journey
            </span>
          </h2>
        </Reveal>

        {/* Bento grid: cards size to their content — no clipping, no overlap */}
        <div className="grid md:grid-cols-6 gap-4" onMouseMove={handleBentoMove}>
          {/* Large: Bilingual Notes */}
          <Reveal className="md:col-span-4 h-full">
            <div className="bento-card shine-effect p-7 sm:p-8 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center mb-4">
                  <Languages className="w-6 h-6 text-accent-blue" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Bilingual AI Notes</h3>
                <p className="text-white/40 text-sm leading-relaxed max-w-md">
                  Every lecture is automatically transcribed and transformed into beautifully organized notes in
                  both Urdu and English — ready to study in minutes, not hours.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-5">
                <span className="text-[10px] font-semibold text-accent-blue bg-accent-blue/10 px-2.5 py-1 rounded-lg border border-accent-blue/15">Urdu</span>
                <span className="text-[10px] font-semibold text-accent-purple bg-accent-purple/10 px-2.5 py-1 rounded-lg border border-accent-purple/15">English</span>
                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/15">Roman Urdu</span>
              </div>
            </div>
          </Reveal>

          {/* Medium: AI Tutor */}
          <Reveal className="md:col-span-2 h-full" delay={90}>
            <div className="bento-card shine-effect p-7 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center mb-4">
                  <MessageCircle className="w-6 h-6 text-accent-purple" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">AI Tutor Chat</h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  Ask anything about your lectures. Our AI tutor is grounded in your actual notes — no hallucinations.
                </p>
              </div>
              <div className="flex items-center gap-1.5 mt-4">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-white/30">Always available</span>
              </div>
            </div>
          </Reveal>

          {/* Medium: Smart Quizzes */}
          <Reveal className="md:col-span-2 h-full">
            <div className="bento-card shine-effect p-7 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 flex items-center justify-center mb-4">
                  <Brain className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Smart Quizzes</h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  AI generates MCQs and short questions directly from your lecture content.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Medium: Auto Transcription */}
          <Reveal className="md:col-span-2 h-full" delay={90}>
            <div className="bento-card shine-effect p-7 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-600/10 flex items-center justify-center mb-4">
                  <Mic className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Auto Transcription</h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  Groq Whisper API captures Urdu and English speech in real-time with high accuracy.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Medium: Mind Maps */}
          <Reveal className="md:col-span-2 h-full" delay={180}>
            <div className="bento-card shine-effect p-7 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center mb-4">
                  <Cpu className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Mind Maps</h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  Interactive visual diagrams that break down complex topics into connected concepts.
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Second bento row */}
        <div className="grid md:grid-cols-3 gap-4 mt-4" onMouseMove={handleBentoMove}>
          {[
            { icon: Shield, title: 'Role-Based Access', desc: 'Separate dashboards for students, teachers, and admins with chairman approval workflow.', iconColor: 'text-emerald-400', iconBg: 'from-emerald-500/20 to-emerald-600/10' },
            { icon: BarChart3, title: 'Progress Tracking', desc: 'Monitor your study progress, quiz scores, and to-do completion across all subjects.', iconColor: 'text-accent-blue', iconBg: 'from-blue-500/20 to-blue-600/10' },
            { icon: Lock, title: 'Secure & Private', desc: 'End-to-end data security with Supabase row-level policies. Your notes stay yours.', iconColor: 'text-accent-purple', iconBg: 'from-purple-500/20 to-purple-600/10' },
          ].map((item, i) => (
            <Reveal key={item.title} className="h-full" delay={i * 90}>
              <div className="bento-card shine-effect p-7 h-full">
                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${item.iconBg} flex items-center justify-center mb-4`}>
                  <item.icon className={`w-5 h-5 ${item.iconColor}`} />
                </div>
                <h3 className="text-base font-bold text-white mb-1.5">{item.title}</h3>
                <p className="text-white/35 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how" className="relative z-10 border-t border-white/[0.04] bg-white/[0.015] scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 sm:py-24">
          <Reveal className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-accent-blue/10 text-accent-blue px-4 py-1.5 rounded-full text-xs font-semibold border border-accent-blue/20 mb-5">
              <Zap className="w-3.5 h-3.5" />
              Simple Workflow
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
              From lecture to <span className="gradient-text">mastery</span>
            </h2>
            <p className="text-white/40 mt-4 max-w-lg mx-auto">Four seamless steps that transform raw lecture audio into structured knowledge.</p>
          </Reveal>

          <div className="grid md:grid-cols-4 gap-10 md:gap-4 relative">
            {/* Connector line (desktop only) */}
            <div className="hidden md:block absolute top-14 left-[12.5%] right-[12.5%] h-[2px]">
              <div className="w-full h-full bg-gradient-to-r from-accent-blue/30 via-accent-purple/30 to-accent-blue/30" />
            </div>

            {[
              { step: 1, title: 'Record', desc: 'Teacher records the lecture with built-in audio capture', icon: Mic, iconColor: 'text-accent-blue', badgeBg: 'bg-accent-blue', ring: 'border-accent-blue/30 group-hover:border-accent-blue/60 group-hover:shadow-accent-blue/10' },
              { step: 2, title: 'Transcribe', desc: 'Groq Whisper converts speech to text in real-time', icon: FileText, iconColor: 'text-accent-purple', badgeBg: 'bg-accent-purple', ring: 'border-accent-purple/30 group-hover:border-accent-purple/60 group-hover:shadow-accent-purple/10' },
              { step: 3, title: 'Generate', desc: 'Gemini AI creates bilingual notes, quizzes & mind maps', icon: Brain, iconColor: 'text-accent-blue', badgeBg: 'bg-accent-blue', ring: 'border-accent-blue/30 group-hover:border-accent-blue/60 group-hover:shadow-accent-blue/10' },
              { step: 4, title: 'Learn', desc: 'Study with AI tutor, quizzes, and visual mind maps', icon: GraduationCap, iconColor: 'text-accent-purple', badgeBg: 'bg-accent-purple', ring: 'border-accent-purple/30 group-hover:border-accent-purple/60 group-hover:shadow-accent-purple/10' },
            ].map((item, i) => (
              <Reveal key={item.step} delay={i * 110}>
                <div className="relative text-center group">
                  {/* Step circle */}
                  <div className="relative z-10 mx-auto mb-6 w-fit">
                    <div className={`w-14 h-14 rounded-2xl bg-navy border-2 ${item.ring} flex items-center justify-center mx-auto group-hover:shadow-lg transition-all duration-300`}>
                      <item.icon className={`w-6 h-6 ${item.iconColor}`} />
                    </div>
                    <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full ${item.badgeBg} flex items-center justify-center shadow-lg`}>
                      <span className="text-[10px] font-black text-white">{item.step}</span>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                  <p className="text-white/35 text-sm leading-relaxed max-w-[220px] mx-auto">{item.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS ===== */}
      <section id="testimonials" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-20 sm:py-24 scroll-mt-20">
        <Reveal className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-400 px-4 py-1.5 rounded-full text-xs font-semibold border border-amber-500/20 mb-5">
            <Star className="w-3.5 h-3.5" />
            What Students Say
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Loved by students
            <br />
            <span className="text-white/40">across every department</span>
          </h2>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              quote: "ClassMind completely changed how I prepare for exams. The bilingual notes save me hours every week — I can finally focus on understanding instead of copying.",
              name: 'Ayesha Khan',
              role: 'BS Computer Science, Part 2',
              initials: 'AK',
              color: 'bg-accent-blue',
            },
            {
              quote: "The AI tutor is incredible. It answers questions based on exactly what our teacher covered — no random textbook answers. It's like having a study partner who never forgets.",
              name: 'Muhammad Rizwan',
              role: 'BS Software Engineering, Part 1',
              initials: 'MR',
              color: 'bg-accent-purple',
            },
            {
              quote: "As a teacher, I love how it auto-generates quizzes from my lectures. My students are more engaged and prepared for exams than ever before.",
              name: 'Dr. Sana Fatima',
              role: 'Lecturer, IITC — UoS',
              initials: 'SF',
              color: 'bg-emerald-500',
            },
          ].map((item, i) => (
            <Reveal key={item.name} className="h-full" delay={i * 100}>
              <div className="testimonial-card group h-full flex flex-col">
                <div className="flex items-center gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map(s => <Star key={s} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                </div>
                <p className="text-white/60 text-sm leading-relaxed mb-6 flex-1">"{item.quote}"</p>
                <div className="flex items-center gap-3 pt-4 border-t border-white/[0.05]">
                  <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center shrink-0`}>
                    <span className="text-xs font-bold text-white">{item.initials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{item.name}</p>
                    <p className="text-white/30 text-xs truncate">{item.role}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pb-24">
        <Reveal>
          <div className="gradient-border p-8 sm:p-14 lg:p-16 text-center relative overflow-hidden">
            {/* Ambient glow inside CTA — promoted to their own layers so they
                never rasterize mid-scroll */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-blue/10 rounded-full blur-3xl pointer-events-none will-change-transform" />
            <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-accent-purple/10 rounded-full blur-3xl pointer-events-none will-change-transform" />

            <div className="relative z-10">
              <div className="mx-auto mb-6">
                <Logo size={64} glow />
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight mb-4">
                Ready to transform
                <br />
                <span className="gradient-text">how you learn?</span>
              </h2>
              <p className="text-white/40 text-base sm:text-lg max-w-md mx-auto mb-8 leading-relaxed">
                Join ClassMind AI today. Your lectures, perfectly organized, in both Urdu and English.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Link to="/register">
                  <Button size="lg" variant="gradient" className="shadow-2xl shadow-accent-blue/25 hover:shadow-accent-blue/40 transition-shadow">
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="dark">
                    I already have an account
                  </Button>
                </Link>
              </div>
              <p className="text-white/20 text-xs mt-6">No credit card required &middot; Free for all UoS students</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="relative z-10 border-t border-white/[0.04] bg-navy-dark/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <Logo size={40} glow />
                <div>
                  <span className="font-bold text-white text-sm">ClassMind AI</span>
                  <p className="text-[10px] text-white/25 -mt-0.5 tracking-widest uppercase">University of Sindh</p>
                </div>
              </div>
              <p className="text-white/30 text-sm leading-relaxed max-w-sm">
                An AI-powered academic platform that transcribes lectures, generates bilingual notes,
                and provides intelligent study tools for Pakistani universities.
              </p>
            </div>
            <div>
              <h4 className="text-white text-xs font-semibold uppercase tracking-widest mb-4">Platform</h4>
              <ul className="space-y-2.5">
                {['Student Dashboard', 'Teacher Portal', 'Admin Panel', 'AI Tutor'].map(link => (
                  <li key={link}><span className="text-white/30 text-sm hover:text-white/60 transition-colors cursor-pointer">{link}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-white text-xs font-semibold uppercase tracking-widest mb-4">Resources</h4>
              <ul className="space-y-2.5">
                {['Documentation', 'Privacy Policy', 'Terms of Service', 'Contact Support'].map(link => (
                  <li key={link}><span className="text-white/30 text-sm hover:text-white/60 transition-colors cursor-pointer">{link}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.04] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-white/20 text-xs text-center sm:text-left">© 2026 ClassMind AI &mdash; Institute of Information Technology & Computer Science, University of Sindh, Jamshoro</p>
            <div className="flex items-center gap-4 shrink-0">
              <span className="text-white/20 text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                All systems operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
