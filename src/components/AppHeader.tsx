import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/ui/Toast'
import { updateProfile, uploadAvatar } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Logo } from '@/components/Logo'
import { getInitials } from '@/lib/helpers'
import {
  LogOut, User, Camera, X, Check, Loader2, ChevronDown, BadgeCheck, Shield, GraduationCap, Home, Menu,
} from 'lucide-react'
import { clsx } from 'clsx'

interface AppHeaderProps {
  /** Shown under the brand name, e.g. "Student Portal". */
  portalName: string
  /** Sticky on scroll (dashboards) vs inline (sub-pages). */
  sticky?: boolean
  /** When provided, a hamburger menu button appears on mobile (lg:hidden) to open a sidebar/drawer. */
  onMenuClick?: () => void
}

/**
 * The single shared app header — logo, portal name, avatar menu with inline
 * profile editing (name + photo) and sign-out. Used by every dashboard and
 * every sub-page so navigation looks identical everywhere, on any screen size.
 */
export function AppHeader({ portalName, sticky = true, onMenuClick }: AppHeaderProps) {
  const { profile, signOut, refreshProfile } = useAuth()
  const { success: toastSuccess, error: toastError } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const roleIcon = profile?.role === 'admin'
    ? <Shield className="w-3.5 h-3.5" />
    : profile?.role === 'teacher'
      ? <GraduationCap className="w-3.5 h-3.5" />
      : <User className="w-3.5 h-3.5" />

  return (
    <>
      <header className={clsx('nav-header z-50 py-3 px-4 sm:px-6', sticky && 'sticky top-0')}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            {onMenuClick && (
              <button onClick={onMenuClick} className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-white/10 transition-colors" aria-label="Open menu">
                <Menu className="w-5 h-5 text-white" />
              </button>
            )}
            <Logo size={40} glow />
            <div className="min-w-0">
              <h1 className="font-bold text-base leading-tight truncate">ClassMind AI</h1>
              <p className="text-[11px] text-white/40 font-medium leading-tight truncate">{portalName}</p>
            </div>
          </div>

          {/* Avatar menu */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 rounded-full pl-1 pr-1.5 sm:pr-2.5 py-1 hover:bg-white/10 transition-colors"
              aria-label="Account menu"
            >
              <UserAvatar
                name={profile?.full_name}
                url={profile?.avatar_url}
                size={36}
                className="ring-2 ring-white/15"
              />
              <ChevronDown className={clsx(
                'hidden sm:block w-4 h-4 text-white/40 transition-transform',
                menuOpen && 'rotate-180',
              )} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-scale-in origin-top-right">
                {/* Menu header */}
                <div className="px-4 py-4 bg-gray-50/80 border-b border-gray-100 flex items-center gap-3">
                  <UserAvatar name={profile?.full_name} url={profile?.avatar_url} size={44} />
                  <div className="min-w-0">
                    <p className="font-bold text-navy text-sm truncate">{profile?.full_name || 'User'}</p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-blue capitalize mt-0.5">
                      {roleIcon}
                      {profile?.role || 'student'}
                      {profile?.is_approved && <BadgeCheck className="w-3 h-3 text-emerald-500" />}
                    </span>
                  </div>
                </div>

                {/* Menu items */}
                <div className="p-1.5">
                  <button
                    onClick={() => { setMenuOpen(false); setEditOpen(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-navy hover:bg-gray-50 transition-colors"
                  >
                    <User className="w-4 h-4 text-gray-400" />
                    Edit profile
                  </button>
                  <button
                    onClick={() => { void signOut() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Profile edit modal */}
      {editOpen && profile && (
        <ProfileEditModal
          key={profile.id + (profile.avatar_url || '')}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false)
            await refreshProfile()
            toastSuccess('Profile updated')
          }}
        />
      )}
    </>
  )
}

/** Circular avatar — photo when set, initials fallback. */
export function UserAvatar({
  name, url, size = 40, className,
}: { name?: string | null; url?: string | null; size?: number; className?: string }) {
  const initials = getInitials(name || 'User')
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-gradient-to-br from-accent-blue to-accent-purple text-white font-bold select-none overflow-hidden shrink-0',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {url
        ? <img src={url} alt={name || 'User'} className="w-full h-full object-cover" />
        : initials}
    </span>
  )
}

/* ── Profile edit modal ─────────────────────────────────────────────────── */

function ProfileEditModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user, profile } = useAuth()
  const { error: toastError } = useToast()
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [previewUrl, setPreviewUrl] = useState<string | null>(profile?.avatar_url || null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingPreview, setUploadingPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Close on backdrop click / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handlePickFile = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toastError('Please choose an image file')
      return
    }
    if (f.size > 5 * 1024 * 1024) {
      toastError('Image is too large — keep it under 5 MB')
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    if (!user) return
    const trimmed = fullName.trim()
    if (!trimmed) {
      toastError('Name cannot be empty')
      return
    }
    setSaving(true)
    try {
      let avatarUrl: string | null | undefined = undefined
      if (file) {
        setUploadingPreview(true)
        const up = await uploadAvatar(user.id, file)
        setUploadingPreview(false)
        if (up.error || !up.url) {
          toastError(up.error || 'Could not upload the picture')
          return
        }
        avatarUrl = up.url
      }
      const res = await updateProfile(user.id, {
        full_name: trimmed,
        ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
      })
      if (!res.ok) {
        toastError(res.error || 'Could not save your profile')
        return
      }
      await onSaved()
    } finally {
      setSaving(false)
      setUploadingPreview(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-navy text-base">Edit profile</h2>
            <p className="text-xs text-gray-400">Your name and photo</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Avatar picker */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group">
              <UserAvatar name={fullName || profile?.full_name} url={previewUrl} size={96} className="ring-4 ring-gray-100" />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-navy text-white flex items-center justify-center shadow-lg border-[3px] border-white hover:bg-accent-blue transition-colors"
                aria-label="Change photo"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-semibold text-accent-blue hover:text-accent-purple transition-colors"
            >
              {previewUrl ? 'Change photo' : 'Upload a photo'}
            </button>
            {previewUrl && !file && profile?.avatar_url && (
              <button
                onClick={() => { setFile(null); setPreviewUrl(null) }}
                className="text-[11px] text-gray-400 hover:text-red-500 transition-colors -mt-1.5"
              >
                Remove current photo
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Input
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            icon={<User className="w-5 h-5" />}
            maxLength={60}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            loading={saving || uploadingPreview}
          >
            {!(saving || uploadingPreview) && <Check className="w-4 h-4" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AppHeader

/**
 * Header for logged-out pages (Login / Register) — the same navy bar, logo and
 * brand as AppHeader, with a Home link in place of the avatar menu.
 */
export function PublicHeader({ pageName }: { pageName: string }) {
  return (
    <header className="nav-header z-50 py-3 px-4 sm:px-6 relative">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Logo size={40} glow />
          <div className="min-w-0">
            <h1 className="font-bold text-base leading-tight truncate">ClassMind AI</h1>
            <p className="text-[11px] text-white/40 font-medium leading-tight truncate">{pageName}</p>
          </div>
        </div>

        {/* Home link */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Home className="w-4 h-4" />
          <span className="hidden sm:inline">Home</span>
        </Link>
      </div>
    </header>
  )
}
