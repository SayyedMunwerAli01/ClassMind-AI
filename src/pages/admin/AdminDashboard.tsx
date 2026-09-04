import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import { useAdminGuard } from '@/hooks/useAdminGuard'
import { useToast } from '@/components/ui/Toast'
import {
  supabase, fetchAllProfiles, fetchAllSubjects,
  fetchStudentEnrollments, fetchTeacherTimetable, fetchAllTimetable,
  updateProfileApproval, createSubject, enrollStudent, assignTeacher,
  createTimetableSlot, updateTimetableSlot, deleteTimetableSlot,
  fetchActiveSessions, forceEndLiveSession,
  updateSubject, deleteSubject, bulkEnrollStudent, unenrollStudent,
  setStudentPart, deleteUser, changeUserRole, unassignTeacher,
} from '@/lib/supabase'
import { formatDate, getInitials, getGreeting } from '@/lib/helpers'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import AppHeader from '@/components/AppHeader'
import type { UserProfile, Subject, StudentEnrollment, TeacherTimetable, ActiveSession } from '@/lib/types'
import {
  Users, BookOpen, CheckCircle2, XCircle, Clock, UserPlus, Plus, GraduationCap,
  CalendarClock, Radio, Square, Pencil, Trash2, Loader2, AlertTriangle,
  LayoutDashboard, X, Search, Filter, Shield,
  ChevronRight, Activity, UserCheck, Layers, Save,
  UserCog,
} from 'lucide-react'
import { clsx } from 'clsx'

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const STALE_MS = 120000
const PARTS = ['1', '2', '3', '4'] as const
const PART_LABELS: Record<string, string> = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' }

function toMinutes(t: string): number { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
function formatSlotTime(t: string): string { const [h, m] = t.split(':').map(Number); const ampm = (h || 0) >= 12 ? 'PM' : 'AM'; return `${((h || 0) % 12) || 12}:${(m || 0).toString().padStart(2, '0')} ${ampm}` }
function formatClock(d: string): string { return new Date(d).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) }
function formatElapsed(started: string, now: number): string { const s = Math.max(0, Math.floor((now - new Date(started).getTime()) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` }

type Tab = 'overview' | 'users' | 'subjects' | 'timetable'
type EnrollMode = 'single' | 'part' | 'all'
interface ModalState { type: string; title: string; message: string; onConfirm: () => void; busy?: boolean }

// ─── Premium UI Components ──────────────────────────────────────────────
const GlassCard = memo(({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={clsx(
    'rounded-2xl bg-white/80 backdrop-blur-md shadow-lg shadow-gray-200/50 border border-white/60 p-5',
    className
  )}>
    {children}
  </div>
))

const IconButton = memo(({ title, onClick, variant = 'default', children, className, disabled }: {
  title: string; onClick: () => void; variant?: 'default' | 'danger'; children: React.ReactNode; className?: string; disabled?: boolean;
}) => (
  <button
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'p-2 rounded-xl text-gray-400 transition-all disabled:opacity-50',
      variant === 'danger' ? 'hover:text-red-500 hover:bg-red-50' : 'hover:text-accent-blue hover:bg-accent-blue/10',
      className
    )}
  >
    {children}
  </button>
))

const EmptyState = memo(({ icon, title, description, actionLabel, onAction }: {
  icon: React.ReactNode; title: string; description?: string; actionLabel?: string; onAction?: () => void;
}) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white/50 rounded-3xl border border-dashed border-gray-200">
    <div className="p-4 mb-4 rounded-2xl bg-gray-50">{icon}</div>
    <h3 className="text-lg font-semibold text-navy">{title}</h3>
    {description && <p className="text-sm text-gray-500 max-w-sm mt-1">{description}</p>}
    {actionLabel && onAction && (
      <button onClick={onAction} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-accent-blue to-accent-purple text-white font-semibold text-sm shadow-md hover:shadow-lg active:scale-95 transition-all">
        {actionLabel}
      </button>
    )}
  </div>
))

// ─── Reusable Sub-Components ───────────────────────────────────────────
const StatCard = memo(({ icon, color, value, label }: { icon: React.ReactNode; color: string; value: number; label: string }) => {
  const bgMap: Record<string, string> = { blue: 'from-blue-500 to-blue-600', amber: 'from-amber-500 to-amber-600', green: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600', purple: 'from-purple-500 to-purple-600' }
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={clsx('w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-white shadow-md bg-gradient-to-br', bgMap[color] || bgMap.blue)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl sm:text-3xl font-extrabold text-navy tabular-nums leading-none">{value}</p>
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium mt-1 truncate">{label}</p>
        </div>
      </div>
    </GlassCard>
  )
})

const QuickAction = memo(({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) => {
  const bgMap: Record<string, string> = { blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100', green: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100', purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100', amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100' }
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/60 shadow-sm hover:shadow-lg transition-all duration-200 active:scale-95 group"
    >
      <div className={clsx('w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center transition-colors', bgMap[color] || bgMap.blue)}>
        {icon}
      </div>
      <span className="text-xs font-semibold text-navy group-hover:text-accent-blue transition-colors">{label}</span>
    </button>
  )
})

const BarRow = memo(({ label, value, max, color }: { label: string; value: number; max: number; color: string }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <span className="text-xs font-bold text-navy">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
})

const SetupStep = memo(({ step, title, desc, done, onClick }: { step: number; title: string; desc: string; done: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={clsx(
      'w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all duration-200 hover:shadow-md active:scale-[0.99]',
      done ? 'bg-white/60 opacity-60' : 'bg-white hover:bg-white/90'
    )}
  >
    <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0', done ? 'bg-emerald-100 text-emerald-600' : 'bg-accent-blue/10 text-accent-blue')}>
      {done ? <CheckCircle2 className="w-5 h-5" /> : step}
    </div>
    <div className="flex-1 min-w-0">
      <p className={clsx('font-semibold text-sm', done ? 'text-gray-400 line-through' : 'text-navy')}>{title}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>
    </div>
    <ChevronRight className={clsx('w-4 h-4 shrink-0', done ? 'text-gray-300' : 'text-gray-400')} />
  </button>
))

const UserRow = memo(({ user: p, onApprove, onSuspend, onRoleChange, onDelete, onPartChange }: {
  user: UserProfile
  onApprove: (u: UserProfile) => void
  onSuspend: (uid: string, sus: boolean) => void
  onRoleChange: (uid: string, role: 'student' | 'teacher') => void
  onDelete: (u: UserProfile) => void
  onPartChange: (uid: string, part: string) => void
}) => {
  return (
    <div className="premium-card flex flex-col sm:flex-row sm:items-center gap-4 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 sm:flex-1 min-w-0">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-navy/5 ring-2 ring-navy/10 flex items-center justify-center font-bold text-navy text-sm shrink-0">
          {getInitials(p.full_name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-navy truncate text-sm">{p.full_name}</p>
            <Badge color={p.role === 'admin' ? 'red' : p.role === 'teacher' ? 'green' : 'blue'}>{p.role}</Badge>
            {p.role === 'student' && p.student_part && <Badge color="purple">Part {p.student_part}</Badge>}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">Joined {formatDate(p.created_at)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {p.is_suspended ? <Badge color="red">Suspended</Badge> : p.is_approved ? <Badge color="green">Active</Badge> : <Badge color="yellow">Pending</Badge>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {!p.is_approved && !p.is_suspended && (
          <Button size="sm" variant="secondary" onClick={() => onApprove(p)}>
            <CheckCircle2 className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Approve</span>
          </Button>
        )}
        {p.is_approved && !p.is_suspended && p.role !== 'admin' && (
          <>
            {p.role === 'student' && (
              <select
                value={p.student_part || ''}
                onChange={e => { if (e.target.value) onPartChange(p.id, e.target.value) }}
                className="w-full sm:w-auto px-2 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-navy bg-white focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                title="Change part"
              >
                <option value="" disabled>Part</option>
                {PARTS.map(pt => <option key={pt} value={pt}>Part {pt}</option>)}
              </select>
            )}
            <Button size="sm" variant="danger" onClick={() => onSuspend(p.id, true)}>
              <XCircle className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Suspend</span>
            </Button>
            <IconButton title={`Change to ${p.role === 'student' ? 'teacher' : 'student'}`} onClick={() => onRoleChange(p.id, p.role === 'student' ? 'teacher' : 'student')}>
              <UserCog className="w-4 h-4" />
            </IconButton>
            <IconButton title="Delete user" variant="danger" onClick={() => onDelete(p)}>
              <Trash2 className="w-4 h-4" />
            </IconButton>
          </>
        )}
        {p.is_suspended && (
          <Button size="sm" variant="secondary" onClick={() => onSuspend(p.id, false)}>
            <CheckCircle2 className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Unsuspend</span>
          </Button>
        )}
      </div>
    </div>
  )
})

// ─── Main Component ─────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { verified, profile } = useAdminGuard()
  const { success: toastSuccess, error: toastError } = useToast()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([])
  const [timetable, setTimetable] = useState<TeacherTimetable[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modal, setModal] = useState<ModalState | null>(null)
  // Users
  const [userSearch, setUserSearch] = useState('')
  const [approveTarget, setApproveTarget] = useState<UserProfile | null>(null)
  const [approvePart, setApprovePart] = useState('')
  const [approveBusy, setApproveBusy] = useState(false)
  // Subjects
  const [partFilter, setPartFilter] = useState<string>('all')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectCode, setNewSubjectCode] = useState('')
  const [newSubjectPart, setNewSubjectPart] = useState('')
  const [editSubjId, setEditSubjId] = useState<string | null>(null)
  const [editSubjName, setEditSubjName] = useState('')
  const [editSubjCode, setEditSubjCode] = useState('')
  const [editSubjPart, setEditSubjPart] = useState('')
  const [editSubjBusy, setEditSubjBusy] = useState(false)
  // Enroll
  const [enrollMode, setEnrollMode] = useState<EnrollMode>('single')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [selectedSubjectForEnrollment, setSelectedSubjectForEnrollment] = useState('')
  const [enrollPart, setEnrollPart] = useState('')
  const [enrollBusy, setEnrollBusy] = useState(false)
  // Assign
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [selectedSubjectForAssignment, setSelectedSubjectForAssignment] = useState('')
  // Live
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [forceEndTarget, setForceEndTarget] = useState<ActiveSession | null>(null)
  const [forceEndBusy, setForceEndBusy] = useState(false)
  // Timetable
  const [ttTeacher, setTtTeacher] = useState('')
  const [ttSubject, setTtSubject] = useState('')
  const [ttDay, setTtDay] = useState('')
  const [ttStart, setTtStart] = useState('')
  const [ttEnd, setTtEnd] = useState('')
  const [creatingSlot, setCreatingSlot] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [editDay, setEditDay] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [updatingSlot, setUpdatingSlot] = useState(false)
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null)

  useEffect(() => {
    if (!verified) return
    const load = async () => {
      setLoading(true)
      try {
        const [p, s, t, a] = await Promise.all([fetchAllProfiles(), fetchAllSubjects(), fetchAllTimetable(), fetchActiveSessions()])
        setProfiles(p); setSubjects(s); setTimetable(t); setActiveSessions(a)
        const enr = await Promise.all(p.filter(x => x.role === 'student').map(x => fetchStudentEnrollments(x.id)))
        setEnrollments(enr.flat())
      } catch (e) { console.error('Admin load error:', e) } finally { setLoading(false) }
    }
    load()
  }, [verified])

  // ── Approve with part ──
  const openApproveModal = useCallback((u: UserProfile) => { setApproveTarget(u); setApprovePart(u.student_part || '1') }, [])
  const handleApproveConfirm = useCallback(async () => {
    if (!approveTarget) return
    setApproveBusy(true)
    try {
      if (await updateProfileApproval(approveTarget.id, true)) {
        if (approveTarget.role === 'student' && approvePart) { await setStudentPart(approveTarget.id, approvePart) }
        setProfiles(p => p.map(x => x.id === approveTarget.id ? { ...x, is_approved: true, student_part: approvePart || x.student_part } : x))
        toastSuccess(`${approveTarget.full_name} approved${approveTarget.role === 'student' ? ` (Part ${approvePart})` : ''}`)
        setApproveTarget(null)
      } else toastError('Failed to approve')
    } finally { setApproveBusy(false) }
  }, [approveTarget, approvePart, toastSuccess, toastError])
  const handleRevoke = useCallback(async (uid: string) => {
    if (await updateProfileApproval(uid, false)) { setProfiles(p => p.map(x => x.id === uid ? { ...x, is_approved: false } : x)); toastSuccess('Approval revoked') } else toastError('Failed')
  }, [toastSuccess, toastError])
  const handleSuspend = useCallback((uid: string, sus: boolean) => {
    const target = profiles.find(p => p.id === uid)
    if (!target) return
    setModal({
      type: sus ? 'danger' : 'info',
      title: sus ? 'Suspend User' : 'Unsuspend User',
      message: sus
        ? `Suspend "${target.full_name}" (${target.role})? They will not be able to log in until you unsuspend them.`
        : `Restore access for "${target.full_name}"?`,
      onConfirm: async () => {
        setModal(m => m ? { ...m, busy: true } : null)
        if (await updateProfileApproval(uid, !sus, sus)) {
          setProfiles(p => p.map(x => x.id === uid ? { ...x, is_suspended: sus } : x))
          toastSuccess(sus ? 'User suspended' : 'User unsuspended')
          setModal(null)
        } else { toastError('Failed'); setModal(null) }
      }
    })
  }, [profiles, toastSuccess, toastError])

  // ── Change student part ──
  const handlePartChange = useCallback(async (uid: string, part: string) => {
    if (await setStudentPart(uid, part)) { setProfiles(p => p.map(x => x.id === uid ? { ...x, student_part: part } : x)); toastSuccess(`Moved to Part ${part}`) } else toastError('Failed')
  }, [toastSuccess, toastError])

  // ── Role change ──
  const handleRoleChange = useCallback(async (uid: string, role: 'student' | 'teacher') => {
    if (await changeUserRole(uid, role)) { setProfiles(p => p.map(x => x.id === uid ? { ...x, role } : x)); toastSuccess(`Role changed to ${role}`) } else toastError('Failed')
  }, [toastSuccess, toastError])

  // ── Delete user ──
  const handleDeleteUser = useCallback((u: UserProfile) => {
    setModal({ type: 'danger', title: 'Delete User', message: `Permanently delete "${u.full_name}"? This removes all their enrollments, notes, and data.`, onConfirm: async () => {
      setModal(m => m ? { ...m, busy: true } : null)
      if (await deleteUser(u.id)) { setProfiles(p => p.filter(x => x.id !== u.id)); setEnrollments(e => e.filter(x => x.student_id !== u.id)); toastSuccess('User deleted'); setModal(null) } else { toastError('Failed'); setModal(null) }
    }})
  }, [toastSuccess, toastError])

  // ── Subject CRUD ──
  const handleCreateSubject = useCallback(async () => {
    if (!newSubjectName || !newSubjectCode || !newSubjectPart) return
    const s = await createSubject(newSubjectName, newSubjectCode, newSubjectPart)
    if (s) { setSubjects(p => [...p, s]); setNewSubjectName(''); setNewSubjectCode(''); setNewSubjectPart(''); toastSuccess(`"${s.subject_name}" created`) } else toastError('Failed')
  }, [newSubjectName, newSubjectCode, newSubjectPart, toastSuccess, toastError])
  const startEditSubject = useCallback((s: Subject) => { setEditSubjId(s.id); setEditSubjName(s.subject_name); setEditSubjCode(s.subject_code); setEditSubjPart(s.part) }, [])
  const handleUpdateSubject = useCallback(async () => {
    if (!editSubjId || !editSubjName || !editSubjCode || !editSubjPart) return
    setEditSubjBusy(true)
    const updated = await updateSubject(editSubjId, { subject_name: editSubjName, subject_code: editSubjCode, part: editSubjPart })
    if (updated) { setSubjects(p => p.map(x => x.id === editSubjId ? { ...x, ...updated } : x)); toastSuccess('Subject updated'); setEditSubjId(null) } else toastError('Update failed')
    setEditSubjBusy(false)
  }, [editSubjId, editSubjName, editSubjCode, editSubjPart, toastSuccess, toastError])
  const handleDeleteSubject = useCallback((s: Subject) => {
    setModal({ type: 'danger', title: 'Delete Subject', message: `Delete "${s.subject_name}" (${s.subject_code})? This removes all enrollments, timetable slots, notes, and todos for this subject.`, onConfirm: async () => {
      setModal(m => m ? { ...m, busy: true } : null)
      if (await deleteSubject(s.id)) { setSubjects(p => p.filter(x => x.id !== s.id)); setEnrollments(e => e.filter(x => x.subject_id !== s.id)); setTimetable(t => t.filter(x => x.subject_id !== s.id)); toastSuccess('Subject deleted'); setModal(null) } else { toastError('Failed'); setModal(null) }
    }})
  }, [toastSuccess, toastError])

  // ── Enrollment ──
  const handleEnroll = useCallback(async () => {
    if (!selectedStudent) return
    setEnrollBusy(true)
    let count = 0
    if (enrollMode === 'single') {
      if (!selectedSubjectForEnrollment) { setEnrollBusy(false); return }
      if (await enrollStudent(selectedStudent, selectedSubjectForEnrollment)) count = 1
    } else if (enrollMode === 'part') {
      if (!enrollPart) { setEnrollBusy(false); return }
      const ids = subjects.filter(s => s.part === enrollPart).map(s => s.id)
      count = await bulkEnrollStudent(selectedStudent, ids)
    } else {
      count = await bulkEnrollStudent(selectedStudent, subjects.map(s => s.id))
    }
    if (count > 0) { const ne = await fetchStudentEnrollments(selectedStudent); setEnrollments(p => [...p.filter(e => e.student_id !== selectedStudent), ...ne]); toastSuccess(`Enrolled in ${count} subject${count > 1 ? 's' : ''}`) } else toastError('Enrollment failed (already enrolled?)')
    setEnrollBusy(false)
  }, [selectedStudent, selectedSubjectForEnrollment, enrollMode, enrollPart, subjects, toastSuccess, toastError])

  const handleUnenroll = useCallback(async (studentId: string, subjectId: string) => {
    if (await unenrollStudent(studentId, subjectId)) { setEnrollments(p => p.filter(e => !(e.student_id === studentId && e.subject_id === subjectId))); toastSuccess('Unenrolled') } else toastError('Failed')
  }, [toastSuccess, toastError])

  const handleAssignTeacher = useCallback(async () => {
    if (!selectedTeacher || !selectedSubjectForAssignment) return
    if (await assignTeacher(selectedTeacher, selectedSubjectForAssignment)) {
      toastSuccess('Teacher assigned')
      setTimetable(await fetchAllTimetable())
    } else toastError('Assignment failed (already assigned?)')
  }, [selectedTeacher, selectedSubjectForAssignment, toastSuccess, toastError])

  const handleUnassignTeacher = useCallback(async (teacherId: string, subjectId: string) => {
    if (await unassignTeacher(teacherId, subjectId)) {
      setTimetable(await fetchAllTimetable())
      toastSuccess('Teacher removed from subject')
    } else toastError('Failed')
  }, [toastSuccess, toastError])

  // ── Live monitor ──
  const refreshLive = useCallback(async () => { setActiveSessions(await fetchActiveSessions()) }, [])
  useEffect(() => { const i = setInterval(() => setClockNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  useEffect(() => { if (!verified) return; const i = setInterval(() => { void refreshLive() }, 15000); return () => clearInterval(i) }, [verified, refreshLive])
  useEffect(() => { if (!verified) return; const ch = supabase.channel('admin-active-sessions').on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, () => { void refreshLive() }).subscribe(); return () => { void supabase.removeChannel(ch) } }, [verified, refreshLive])

  // ── Timetable CRUD ──
  const handleCreateSlot = useCallback(async () => {
    if (!ttTeacher || !ttSubject || !ttDay || !ttStart || !ttEnd) return
    if (toMinutes(ttEnd) <= toMinutes(ttStart)) { toastError('End must be after start'); return }
    setCreatingSlot(true)
    try { await createTimetableSlot(ttTeacher, ttSubject, ttDay, ttStart, ttEnd); toastSuccess('Slot added'); setTtDay(''); setTtStart(''); setTtEnd(''); setTimetable(await fetchAllTimetable()) } catch (e: any) { toastError(e.message || 'Failed') } finally { setCreatingSlot(false) }
  }, [ttTeacher, ttSubject, ttDay, ttStart, ttEnd, toastError, toastSuccess])
  const startEditSlot = useCallback((s: TeacherTimetable) => { setEditingSlotId(s.id); setEditDay(s.day_of_week || ''); setEditStart(s.start_time || ''); setEditEnd(s.end_time || '') }, [])
  const handleUpdateSlot = useCallback(async (id: string) => {
    if (!editDay || !editStart || !editEnd) { toastError('Set day, start & end'); return }
    if (toMinutes(editEnd) <= toMinutes(editStart)) { toastError('End must be after start'); return }
    setUpdatingSlot(true)
    try { await updateTimetableSlot(id, { day_of_week: editDay, start_time: editStart, end_time: editEnd }); toastSuccess('Slot updated'); setEditingSlotId(null); setTimetable(await fetchAllTimetable()) } catch (e: any) { toastError(e.message || 'Failed') } finally { setUpdatingSlot(false) }
  }, [editDay, editStart, editEnd, toastSuccess, toastError])
  const handleDeleteSlot = useCallback(async (id: string) => { setDeletingSlotId(id); try { await deleteTimetableSlot(id); toastSuccess('Slot removed'); setTimetable(p => p.filter(t => t.id !== id)) } catch (e: any) { toastError(e.message || 'Failed') } finally { setDeletingSlotId(null) } }, [toastSuccess, toastError])
  const handleForceEnd = useCallback(async (s: ActiveSession) => { setForceEndBusy(true); try { if (await forceEndLiveSession(s.id, profile?.full_name || 'Admin')) { setForceEndTarget(null); toastSuccess('Live class ended'); await refreshLive() } else toastError('Could not end session') } finally { setForceEndBusy(false) } }, [profile, refreshLive, toastSuccess, toastError])

  // ── Derived ──
  const pendingUsers = useMemo(() => profiles.filter(p => !p.is_approved), [profiles])
  const approvedStudents = useMemo(() => profiles.filter(p => p.role === 'student' && p.is_approved && !p.is_suspended), [profiles])
  const approvedTeachers = useMemo(() => profiles.filter(p => p.role === 'teacher' && p.is_approved && !p.is_suspended), [profiles])
  const suspendedUsers = useMemo(() => profiles.filter(p => p.is_suspended), [profiles])
  const searchQ = userSearch.trim().toLowerCase()
  const searchedProfiles = useMemo(() => {
    if (!searchQ) return profiles
    return profiles.filter(p => p.full_name.toLowerCase().includes(searchQ))
  }, [profiles, searchQ])
  const adminUsers = useMemo(() => searchedProfiles.filter(p => p.role === 'admin'), [searchedProfiles])
  const teacherUsers = useMemo(() => searchedProfiles.filter(p => p.role === 'teacher'), [searchedProfiles])
  const studentUsers = useMemo(() => searchedProfiles.filter(p => p.role === 'student'), [searchedProfiles])
  const studentsByPart = useMemo(() => {
    const g = new Map<string, UserProfile[]>()
    for (const part of PARTS) g.set(part, [])
    g.set('none', [])
    for (const s of studentUsers) {
      const key = s.student_part || 'none'
      if (g.has(key)) g.get(key)!.push(s); else g.get('none')!.push(s)
    }
    return g
  }, [studentUsers])
  const totalMatched = adminUsers.length + teacherUsers.length + studentUsers.length
  const filteredSubjects = useMemo(() => partFilter === 'all' ? subjects : subjects.filter(s => s.part === partFilter), [subjects, partFilter])
  const subjectById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects])
  const teacherNameById = useMemo(() => new Map(profiles.map(p => [p.id, p.full_name])), [profiles])
  const studentOptions = useMemo(() => approvedStudents.map(s => ({ value: s.id, label: s.full_name })), [approvedStudents])
  const teacherOptions = useMemo(() => approvedTeachers.map(t => ({ value: t.id, label: t.full_name })), [approvedTeachers])
  const subjectOptions = useMemo(() => subjects.map(s => ({ value: s.id, label: `${s.subject_name} (Part ${s.part})` })), [subjects])
  const dayOptions = DAY_ORDER.map(d => ({ value: d, label: d }))
  const selectedTeacherAssignments = useMemo(() => timetable.filter(t => t.teacher_id === selectedTeacher), [timetable, selectedTeacher])
  const selectedStudentEnrollments = useMemo(() => enrollments.filter(e => e.student_id === selectedStudent), [enrollments, selectedStudent])
  const partGroups = useMemo(() => {
    const g = new Map<string, TeacherTimetable[]>()
    for (const slot of timetable) { const part = subjectById.get(slot.subject_id)?.part || 'Unsorted'; if (!g.has(part)) g.set(part, []); g.get(part)!.push(slot) }
    for (const slots of g.values()) slots.sort((a, b) => { const da = a.day_of_week ? DAY_ORDER.indexOf(a.day_of_week) : 99; const db = b.day_of_week ? DAY_ORDER.indexOf(b.day_of_week) : 99; return da !== db ? da - db : toMinutes(a.start_time || '00:00') - toMinutes(b.start_time || '00:00') })
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [timetable, subjectById])
  const navigateTo = (tab: Tab) => { setActiveTab(tab); setDrawerOpen(false) }
  if (!verified) return null

  const navItems: { key: Tab; label: string; icon: React.ReactNode; badge?: number; live?: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-5 h-5" /> },
    { key: 'users', label: 'Users', icon: <Users className="w-5 h-5" />, badge: pendingUsers.length },
    { key: 'subjects', label: 'Subjects', icon: <BookOpen className="w-5 h-5" /> },
    { key: 'timetable', label: 'Timetable', icon: <CalendarClock className="w-5 h-5" />, live: activeSessions.length > 0 },
  ]

  const sidebarContent = (
    <nav className="flex flex-col gap-1 p-4">
      {navItems.map(item => (
        <button
          key={item.key}
          onClick={() => navigateTo(item.key)}
          className={clsx(
            'admin-sidebar-link w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
            activeTab === item.key ? 'bg-accent-blue/10 text-accent-blue font-semibold' : 'hover:bg-gray-50 text-gray-600'
          )}
        >
          {item.icon}
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold', activeTab === item.key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700')}>
              {item.badge}
            </span>
          )}
          {item.live && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
        </button>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-accent-light overflow-x-hidden">
      <AppHeader portalName="Admin Portal" onMenuClick={() => setDrawerOpen(true)} />

      {/* Confirm Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !modal.busy && setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className={clsx('p-6', modal.type === 'danger' ? 'bg-red-50' : 'bg-blue-50')}>
              <div className="flex items-center gap-3 mb-2">
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', modal.type === 'danger' ? 'bg-red-100' : 'bg-blue-100')}>
                  {modal.type === 'danger' ? <AlertTriangle className="w-5 h-5 text-red-500" /> : <AlertTriangle className="w-5 h-5 text-blue-500" />}
                </div>
                <h3 className="font-bold text-navy text-lg">{modal.title}</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{modal.message}</p>
            </div>
            <div className="flex gap-3 p-5 justify-end">
              <Button variant="secondary" onClick={() => setModal(null)} disabled={modal.busy}>Cancel</Button>
              <Button variant="danger" onClick={modal.onConfirm} loading={modal.busy}>
                <Trash2 className="w-4 h-4" /> Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !approveBusy && setApproveTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 bg-gradient-to-br from-accent-blue/5 to-accent-purple/5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-accent-blue" />
                </div>
                <div>
                  <h3 className="font-bold text-navy text-lg">Approve User</h3>
                  <p className="text-xs text-gray-500">{approveTarget.full_name} · {approveTarget.role}</p>
                </div>
              </div>
              {approveTarget.role === 'student' && (
                <div>
                  <label className="block text-xs font-bold text-navy mb-2">Assign to Part / Year</label>
                  <Select
                    value={approvePart}
                    onChange={e => setApprovePart(e.target.value)}
                    options={PARTS.map(p => ({ value: p, label: `Part ${p} — ${PART_LABELS[p]}` }))}
                  />
                  <p className="text-[11px] text-gray-400 mt-2">This determines which subjects the student sees on their dashboard.</p>
                </div>
              )}
            </div>
            <div className="flex gap-3 p-5 justify-end">
              <Button variant="secondary" onClick={() => setApproveTarget(null)} disabled={approveBusy}>Cancel</Button>
              <Button variant="gradient" onClick={handleApproveConfirm} loading={approveBusy}>
                <CheckCircle2 className="w-4 h-4" /> Approve
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-[65px] h-[calc(100vh-65px)] border-r border-gray-100 bg-white overflow-y-auto">
          <div className="px-5 pt-6 pb-3">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Navigation</p>
          </div>
          {sidebarContent}
          <div className="px-5 py-4 mt-auto border-t border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-navy/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-navy" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-navy truncate">{profile?.full_name}</p>
                <p className="text-[10px] text-gray-400">Administrator</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Side Drawer (using global CSS classes) */}
        {drawerOpen && (
          <>
            <div className="admin-mobile-overlay" onClick={() => setDrawerOpen(false)} />
            <div className="admin-drawer">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <p className="font-bold text-navy">Menu</p>
                <button onClick={() => setDrawerOpen(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="px-5 pt-4 pb-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Navigation</p>
              </div>
              {sidebarContent}
            </div>
          </>
        )}

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 max-w-6xl overflow-x-hidden">
          <div className="flex items-center gap-3 mb-6">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold text-navy tracking-tight truncate">
                {activeTab === 'overview' && `${getGreeting()}${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
                {activeTab === 'users' && 'User Management'}
                {activeTab === 'subjects' && 'Subjects & Enrollments'}
                {activeTab === 'timetable' && 'Timetable & Live Monitor'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5 truncate">
                {activeTab === 'overview' && "Here's what's happening across your platform"}
                {activeTab === 'users' && `${profiles.length} registered users`}
                {activeTab === 'subjects' && `${subjects.length} subjects across ${PARTS.length} parts`}
                {activeTab === 'timetable' && `${timetable.length} slots · ${activeSessions.length} live`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} variant="rect" className="h-20 rounded-2xl" />)}
            </div>
          ) : (
            <>
              {/* ── OVERVIEW ── */}
              {activeTab === 'overview' && (
                <div className="space-y-6 animate-fade-in">
                  {profiles.length <= 1 && subjects.length === 0 && timetable.length === 0 && (
                    <GlassCard className="p-6 bg-gradient-to-br from-accent-blue/5 to-accent-purple/5 border-accent-blue/20">
                      <h3 className="font-bold text-navy text-lg mb-2">Welcome! Let's set up your platform</h3>
                      <p className="text-sm text-gray-500 mb-5">Follow these steps in order. Each one takes less than a minute.</p>
                      <div className="space-y-3">
                        <SetupStep step={1} title="Create your first subject" desc="Go to Subjects tab and add a subject with name, code and part." done={subjects.length > 0} onClick={() => setActiveTab('subjects')} />
                        <SetupStep step={2} title="Approve teachers & students" desc="When users register, approve them from the Users tab." done={profiles.filter(p => p.is_approved && p.role !== 'admin').length > 0} onClick={() => setActiveTab('users')} />
                        <SetupStep step={3} title="Enroll students in subjects" desc="In Subjects tab, select a student and enroll them in one or more subjects." done={enrollments.length > 0} onClick={() => setActiveTab('subjects')} />
                        <SetupStep step={4} title="Set the timetable" desc="Add class slots so teachers know when they can go live." done={timetable.length > 0} onClick={() => setActiveTab('timetable')} />
                      </div>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <StatCard icon={<Users className="w-5 h-5" />} color="blue" value={profiles.length} label="Total Users" />
                    <StatCard icon={<Clock className="w-5 h-5" />} color="amber" value={pendingUsers.length} label="Pending Approval" />
                    <StatCard icon={<BookOpen className="w-5 h-5" />} color="green" value={subjects.length} label="Subjects" />
                    <StatCard icon={<Activity className="w-5 h-5" />} color="purple" value={activeSessions.length} label="Live Now" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <QuickAction icon={<UserPlus className="w-5 h-5" />} label="Add Subject" color="blue" onClick={() => setActiveTab('subjects')} />
                    <QuickAction icon={<Users className="w-5 h-5" />} label="Manage Users" color="green" onClick={() => setActiveTab('users')} />
                    <QuickAction icon={<CalendarClock className="w-5 h-5" />} label="Timetable" color="purple" onClick={() => setActiveTab('timetable')} />
                    <QuickAction icon={<GraduationCap className="w-5 h-5" />} label="Assign Teacher" color="amber" onClick={() => setActiveTab('subjects')} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <GlassCard className="p-5">
                      <h3 className="font-bold text-navy mb-4 flex items-center gap-2 text-sm"><UserCheck className="w-4 h-4 text-accent-blue" /> User Breakdown</h3>
                      <div className="space-y-3">
                        <BarRow label="Students" value={approvedStudents.length} max={profiles.length} color="bg-accent-blue" />
                        <BarRow label="Teachers" value={approvedTeachers.length} max={profiles.length} color="bg-emerald-500" />
                        <BarRow label="Pending" value={pendingUsers.length} max={profiles.length} color="bg-amber-500" />
                        <BarRow label="Suspended" value={suspendedUsers.length} max={profiles.length} color="bg-red-500" />
                      </div>
                    </GlassCard>
                    <GlassCard className="p-5">
                      <h3 className="font-bold text-navy mb-4 flex items-center gap-2 text-sm"><Layers className="w-4 h-4 text-accent-purple" /> Student Distribution by Part</h3>
                      <div className="space-y-3">
                        {approvedStudents.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-6">No students yet</p>
                        ) : (
                          PARTS.map(part => {
                            const count = approvedStudents.filter(s => s.student_part === part).length
                            const subjCount = subjects.filter(s => s.part === part).length
                            return (
                              <div key={part} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-6 h-6 rounded-lg bg-navy/5 text-navy text-[11px] font-bold flex items-center justify-center">{part}</span>
                                  <span className="text-sm text-gray-600">{PART_LABELS[part]}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge color="blue">{count} students</Badge>
                                  <Badge color="purple">{subjCount} subj</Badge>
                                </div>
                              </div>
                            )
                          })
                        )}
                        {approvedStudents.filter(s => !s.student_part).length > 0 && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 text-[11px] font-bold flex items-center justify-center">?</span>
                              <span className="text-sm text-amber-600">Unassigned</span>
                            </div>
                            <Badge color="yellow">{approvedStudents.filter(s => !s.student_part).length} students</Badge>
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </div>
                  {pendingUsers.length > 0 && (
                    <GlassCard className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-navy text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Pending Approvals</h3>
                        <button onClick={() => setActiveTab('users')} className="text-xs font-semibold text-accent-blue hover:text-accent-purple flex items-center gap-1">
                          View all <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="space-y-2">
                        {pendingUsers.slice(0, 3).map(p => (
                          <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 hover:bg-white transition-colors">
                            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                              {getInitials(p.full_name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-navy truncate">{p.full_name}</p>
                              <p className="text-[11px] text-gray-400 capitalize">{p.role} · Joined {formatDate(p.created_at)}</p>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => openApproveModal(p)}>
                              <CheckCircle2 className="w-4 h-4" /> <span className="hidden sm:inline">Approve</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </GlassCard>
                  )}
                </div>
              )}

              {/* ── USERS ── */}
              {activeTab === 'users' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="sticky top-20 z-10 bg-accent-light/80 backdrop-blur-sm py-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search users by name..."
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        className="admin-search-input w-full"
                      />
                      {userSearch && (
                        <button onClick={() => setUserSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100">
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                    </div>
                  </div>

                  {totalMatched === 0 ? (
                    <EmptyState
                      icon={<Users className="w-12 h-12 text-gray-200" />}
                      title={userSearch ? `No users match "${userSearch}"` : 'No users yet'}
                      description={userSearch ? 'Try a different search term.' : 'Users will appear here once they register.'}
                      actionLabel={userSearch ? 'Clear search' : undefined}
                      onAction={userSearch ? () => setUserSearch('') : undefined}
                    />
                  ) : (
                    <>
                      {adminUsers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-2 h-6 rounded-full bg-red-400" />
                            <h3 className="font-bold text-navy text-sm">Admins</h3>
                            <Badge color="red">{adminUsers.length}</Badge>
                          </div>
                          <div className="space-y-2">
                            {adminUsers.map(p => <UserRow key={p.id} user={p} onApprove={openApproveModal} onSuspend={handleSuspend} onRoleChange={handleRoleChange} onDelete={handleDeleteUser} onPartChange={handlePartChange} />)}
                          </div>
                        </div>
                      )}

                      {teacherUsers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-2 h-6 rounded-full bg-emerald-400" />
                            <h3 className="font-bold text-navy text-sm">Teachers</h3>
                            <Badge color="green">{teacherUsers.length}</Badge>
                          </div>
                          <div className="space-y-2">
                            {teacherUsers.map(p => <UserRow key={p.id} user={p} onApprove={openApproveModal} onSuspend={handleSuspend} onRoleChange={handleRoleChange} onDelete={handleDeleteUser} onPartChange={handlePartChange} />)}
                          </div>
                        </div>
                      )}

                      {studentUsers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-2 h-6 rounded-full bg-accent-blue" />
                            <h3 className="font-bold text-navy text-sm">Students</h3>
                            <Badge color="blue">{studentUsers.length}</Badge>
                          </div>
                          <div className="space-y-4">
                            {PARTS.map(part => {
                              const partStudents = studentsByPart.get(part) || []
                              if (partStudents.length === 0) return null
                              return (
                                <div key={part}>
                                  <div className="flex items-center gap-2 mb-2 ml-1">
                                    <span className="w-6 h-6 rounded-lg bg-accent-blue/10 text-accent-blue text-[11px] font-bold flex items-center justify-center">{part}</span>
                                    <span className="text-xs font-semibold text-gray-600">{PART_LABELS[part]}</span>
                                    <span className="text-[11px] text-gray-400 font-medium">{partStudents.length}</span>
                                  </div>
                                  <div className="space-y-2">
                                    {partStudents.map(p => <UserRow key={p.id} user={p} onApprove={openApproveModal} onSuspend={handleSuspend} onRoleChange={handleRoleChange} onDelete={handleDeleteUser} onPartChange={handlePartChange} />)}
                                  </div>
                                </div>
                              )
                            })}
                            {(studentsByPart.get('none') || []).length > 0 && (
                              <div>
                                <div className="flex items-center gap-2 mb-2 ml-1">
                                  <span className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 text-[11px] font-bold flex items-center justify-center">?</span>
                                  <span className="text-xs font-semibold text-amber-600">Unassigned</span>
                                  <span className="text-[11px] text-gray-400 font-medium">{(studentsByPart.get('none') || []).length}</span>
                                </div>
                                <div className="space-y-2">
                                  {(studentsByPart.get('none') || []).map(p => <UserRow key={p.id} user={p} onApprove={openApproveModal} onSuspend={handleSuspend} onRoleChange={handleRoleChange} onDelete={handleDeleteUser} onPartChange={handlePartChange} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── SUBJECTS ── */}
              {activeTab === 'subjects' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="sticky top-20 z-10 bg-accent-light/80 backdrop-blur-sm py-2">
                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                      <Filter className="w-4 h-4 text-gray-400 shrink-0" />
                      <button onClick={() => setPartFilter('all')} className={clsx('admin-part-chip text-xs', partFilter === 'all' ? 'chip-active' : 'chip-inactive')}>All Parts</button>
                      {PARTS.map(p => <button key={p} onClick={() => setPartFilter(p)} className={clsx('admin-part-chip text-xs', partFilter === p ? 'chip-active' : 'chip-inactive')}>Part {p}</button>)}
                    </div>
                  </div>

                  <GlassCard className="p-5">
                    <h3 className="font-bold text-navy text-sm mb-4 flex items-center gap-2">
                      <Plus className="w-4 h-4 text-accent-blue" /> Create New Subject
                    </h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <Input placeholder="Subject Name" value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)} />
                      <Input placeholder="Subject Code" value={newSubjectCode} onChange={e => setNewSubjectCode(e.target.value)} />
                      <Select label="Select Part" value={newSubjectPart} onChange={e => setNewSubjectPart(e.target.value)} options={PARTS.map(p => ({ value: p, label: `Part ${p} — ${PART_LABELS[p]}` }))} placeholder="Choose part..." />
                      <div className="flex items-end">
                        <Button onClick={handleCreateSubject} disabled={!newSubjectName || !newSubjectCode || !newSubjectPart} variant="gradient" className="w-full hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all">
                          <Plus className="w-4 h-4" /> Create
                        </Button>
                      </div>
                    </div>
                  </GlassCard>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-navy text-sm">{partFilter === 'all' ? 'All Subjects' : `Part ${partFilter} Subjects`}</h3>
                      <span className="text-xs text-gray-400 font-medium">{filteredSubjects.length} total</span>
                    </div>
                    {filteredSubjects.length === 0 ? (
                      <EmptyState
                        icon={<BookOpen className="w-12 h-12 text-gray-200" />}
                        title={partFilter === 'all' ? 'No subjects yet. Create your first one above!' : `No subjects for Part ${partFilter}`}
                        actionLabel={partFilter !== 'all' ? 'Show all subjects' : undefined}
                        onAction={partFilter !== 'all' ? () => setPartFilter('all') : undefined}
                      />
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {filteredSubjects.map(s => {
                          const enr = enrollments.filter(e => e.subject_id === s.id).length
                          const tch = timetable.filter(t => t.subject_id === s.id).length
                          const isEditing = editSubjId === s.id
                          return isEditing ? (
                            <div key={s.id} className="premium-card p-4 border-accent-blue/30">
                              <p className="text-xs font-bold text-navy mb-3">Edit Subject</p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                                <Input placeholder="Name" value={editSubjName} onChange={e => setEditSubjName(e.target.value)} />
                                <Input placeholder="Code" value={editSubjCode} onChange={e => setEditSubjCode(e.target.value)} />
                                <Select value={editSubjPart} onChange={e => setEditSubjPart(e.target.value)} options={PARTS.map(p => ({ value: p, label: `Part ${p}` }))} />
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={handleUpdateSubject} loading={editSubjBusy}><Save className="w-3.5 h-3.5" /> Save</Button>
                                <Button size="sm" variant="secondary" onClick={() => setEditSubjId(null)}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div key={s.id} className="premium-card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-md">
                                {s.subject_name[0]}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-navy text-sm truncate">{s.subject_name}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">{s.subject_code} · Part {s.part}</p>
                                <div className="flex gap-1.5 mt-2 flex-wrap">
                                  <Badge color="blue">{enr} enrolled</Badge>
                                  <Badge color="purple">{tch} teachers</Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <IconButton title="Edit subject" onClick={() => startEditSubject(s)}>
                                  <Pencil className="w-4 h-4" />
                                </IconButton>
                                <IconButton title="Delete subject" variant="danger" onClick={() => handleDeleteSubject(s)}>
                                  <Trash2 className="w-4 h-4" />
                                </IconButton>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Enroll + Assign */}
                  <div className="grid sm:grid-cols-2 gap-4 min-w-0">
                    <GlassCard className="p-5 min-w-0 overflow-hidden">
                      <h3 className="font-bold text-navy text-sm mb-4 flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-accent-blue" /> Enroll Student
                      </h3>
                      <div className="space-y-3">
                        <Select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)} options={studentOptions} placeholder="Select student..." />
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => setEnrollMode('single')} className={clsx('enroll-tab', enrollMode === 'single' ? 'enroll-tab-active' : 'enroll-tab-inactive')}>Single Subject</button>
                          <button onClick={() => setEnrollMode('part')} className={clsx('enroll-tab', enrollMode === 'part' ? 'enroll-tab-active' : 'enroll-tab-inactive')}>By Part</button>
                          <button onClick={() => setEnrollMode('all')} className={clsx('enroll-tab', enrollMode === 'all' ? 'enroll-tab-active' : 'enroll-tab-inactive')}>All Subjects</button>
                        </div>
                        {enrollMode === 'single' && <Select value={selectedSubjectForEnrollment} onChange={e => setSelectedSubjectForEnrollment(e.target.value)} options={subjectOptions} placeholder="Select subject..." />}
                        {enrollMode === 'part' && <Select value={enrollPart} onChange={e => setEnrollPart(e.target.value)} options={PARTS.map(p => ({ value: p, label: `Part ${p} — ${PART_LABELS[p]} (${subjects.filter(s => s.part === p).length} subjects)` }))} placeholder="Select part..." />}
                        {enrollMode === 'all' && <p className="text-xs text-gray-500 bg-blue-50 p-3 rounded-xl border border-blue-100">Will enroll in all <strong>{subjects.length}</strong> subjects across all parts.</p>}
                        <Button onClick={handleEnroll} loading={enrollBusy} disabled={!selectedStudent || (enrollMode === 'single' && !selectedSubjectForEnrollment) || (enrollMode === 'part' && !enrollPart)} className="w-full hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all">
                          <UserPlus className="w-4 h-4" /> {enrollMode === 'single' ? 'Enroll' : enrollMode === 'part' ? `Enroll in Part` : `Enroll in All`}
                        </Button>
                        {selectedStudent && selectedStudentEnrollments.length > 0 && (
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">Currently enrolled ({selectedStudentEnrollments.length})</p>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto overflow-x-hidden">
                              {selectedStudentEnrollments.map(e => {
                                const subj = subjectById.get(e.subject_id)
                                return subj ? (
                                  <span key={e.id} className="enrolled-chip" title="Click to unenroll">
                                    <span>{subj.subject_name}</span>
                                    <button onClick={() => handleUnenroll(selectedStudent, e.subject_id)} className="ml-0.5 hover:text-red-500">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ) : null
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </GlassCard>

                    <GlassCard className="p-5 min-w-0 overflow-hidden">
                      <h3 className="font-bold text-navy text-sm mb-4 flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-accent-purple" /> Assign Teacher
                      </h3>
                      <div className="space-y-3">
                        <Select value={selectedTeacher} onChange={e => setSelectedTeacher(e.target.value)} options={teacherOptions} placeholder="Select teacher..." />
                        <Select value={selectedSubjectForAssignment} onChange={e => setSelectedSubjectForAssignment(e.target.value)} options={subjectOptions} placeholder="Select subject..." />
                        <Button onClick={handleAssignTeacher} disabled={!selectedTeacher || !selectedSubjectForAssignment} className="w-full hover:shadow-lg hover:shadow-purple-500/20 active:scale-95 transition-all">
                          <GraduationCap className="w-4 h-4" /> Assign
                        </Button>
                        {selectedTeacher && selectedTeacherAssignments.length > 0 && (
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">Currently teaches ({selectedTeacherAssignments.length})</p>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto overflow-x-hidden">
                              {selectedTeacherAssignments.map(a => {
                                const subj = subjectById.get(a.subject_id)
                                return subj ? (
                                  <span key={a.id} className="enrolled-chip" title="Click to remove">
                                    <span>{subj.subject_name}</span>
                                    <button onClick={() => handleUnassignTeacher(selectedTeacher, a.subject_id)} className="ml-0.5 hover:text-red-500">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ) : null
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </div>
                </div>
              )}

              {/* ── TIMETABLE ── */}
              {activeTab === 'timetable' && (
                <div className="space-y-6 animate-fade-in">
                  <GlassCard className="p-5 border border-red-100/50 bg-gradient-to-br from-white to-red-50/30">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', activeSessions.length > 0 ? 'bg-red-50' : 'bg-gray-50')}>
                          <Radio className={clsx('w-5 h-5', activeSessions.length > 0 ? 'text-red-500 animate-pulse' : 'text-gray-400')} />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-navy">Live Monitor</h3>
                          <p className="text-[11px] text-gray-400">One live class per part</p>
                        </div>
                      </div>
                      {activeSessions.length > 0 && <Badge color="red">{activeSessions.length} live</Badge>}
                    </div>
                    {activeSessions.length === 0 ? (
                      <div className="text-center py-8">
                        <Radio className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400 font-medium">No classes live right now</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activeSessions.map(session => {
                          const tName = teacherNameById.get(session.teacher_id) || 'Unknown'
                          const subj = subjectById.get(session.subject_id)
                          const stale = clockNow - new Date(session.last_ping || session.started_at).getTime() > STALE_MS
                          const isTarget = forceEndTarget?.id === session.id
                          return (
                            <div key={session.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/80 border border-gray-100 flex-wrap transition-all hover:shadow-sm">
                              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                {getInitials(tName)}
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                              </div>
                              <div className="flex-1 min-w-[140px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-bold text-navy text-sm">{tName}</p>
                                  {stale ? <Badge color="yellow"><AlertTriangle className="w-3 h-3 mr-1" />Stale</Badge> : <Badge color="green">OK</Badge>}
                                </div>
                                <p className="text-[11px] text-gray-500 mt-0.5">
                                  {subj?.subject_name || '—'} · Part {session.part || '—'} · {formatClock(session.started_at)}
                                </p>
                              </div>
                              <div className="text-left sm:text-right shrink-0">
                                <p className="font-mono text-sm font-bold text-navy tabular-nums">{formatElapsed(session.started_at, clockNow)}</p>
                                <p className="text-[10px] text-gray-400 uppercase font-bold">elapsed</p>
                              </div>
                              <div className="w-full sm:w-auto flex justify-end shrink-0 gap-2">
                                {isTarget ? (
                                  <>
                                    <Button variant="danger" size="sm" loading={forceEndBusy} onClick={() => void handleForceEnd(session)}>Confirm</Button>
                                    <Button variant="secondary" size="sm" onClick={() => setForceEndTarget(null)}>Cancel</Button>
                                  </>
                                ) : (
                                  <Button variant="danger" size="sm" onClick={() => setForceEndTarget(session)}>
                                    <Square className="w-3.5 h-3.5" /> End
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-5">
                    <h3 className="font-bold text-navy text-sm mb-1 flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-accent-blue" /> Add Timetable Slot
                    </h3>
                    <p className="text-[11px] text-gray-400 mb-4">Teachers can go live only during their scheduled slot.</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <Select label="Teacher" value={ttTeacher} onChange={e => setTtTeacher(e.target.value)} options={teacherOptions} placeholder="Select teacher..." />
                      <Select label="Subject" value={ttSubject} onChange={e => setTtSubject(e.target.value)} options={subjectOptions} placeholder="Select subject..." />
                      <Select label="Day" value={ttDay} onChange={e => setTtDay(e.target.value)} options={dayOptions} placeholder="Select day..." />
                      <div>
                        <label className="block text-xs font-semibold text-navy mb-1.5">Starts</label>
                        <input type="time" value={ttStart} onChange={e => setTtStart(e.target.value)} className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-accent-blue focus:outline-none focus:ring-4 focus:ring-accent-blue/10 transition-all bg-white text-navy text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-navy mb-1.5">Ends</label>
                        <input type="time" value={ttEnd} onChange={e => setTtEnd(e.target.value)} className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-accent-blue focus:outline-none focus:ring-4 focus:ring-accent-blue/10 transition-all bg-white text-navy text-sm" />
                      </div>
                      <div className="flex items-end">
                        <Button onClick={() => void handleCreateSlot()} disabled={!ttTeacher || !ttSubject || !ttDay || !ttStart || !ttEnd} loading={creatingSlot} variant="gradient" className="w-full hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all">
                          <Plus className="w-4 h-4" /> Add Slot
                        </Button>
                      </div>
                    </div>
                  </GlassCard>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-navy text-sm">Weekly Timetable</h3>
                      <span className="text-xs text-gray-400 font-medium">{partGroups.length} part{partGroups.length !== 1 ? 's' : ''} · {timetable.length} slot{timetable.length !== 1 ? 's' : ''}</span>
                    </div>
                    {partGroups.length === 0 ? (
                      <EmptyState
                        icon={<CalendarClock className="w-12 h-12 text-gray-200" />}
                        title="No timetable slots yet"
                        description="Add one above so teachers know when they can go live."
                      />
                    ) : (
                      <div className="space-y-5">
                        {partGroups.map(([part, slots]) => (
                          <div key={part}>
                            <div className="flex items-center gap-2 mb-3 flex-wrap">
                              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple text-white flex items-center justify-center text-[11px] font-bold shadow-sm">{part}</div>
                              <h4 className="font-bold text-navy text-sm">Part {part} — {PART_LABELS[part] || ''}</h4>
                              <Badge color="gray">{slots.length}</Badge>
                              {activeSessions.some(s => s.part === part) && <Badge color="red">Live</Badge>}
                            </div>
                            <div className="space-y-2">
                              {slots.map(slot => {
                                const slotSubj = subjectById.get(slot.subject_id)
                                const slotTch = teacherNameById.get(slot.teacher_id) || 'Teacher'
                                const isEditing = editingSlotId === slot.id
                                const scheduled = !!(slot.day_of_week && slot.start_time && slot.end_time)
                                return isEditing ? (
                                  <div key={slot.id} className="p-4 rounded-xl border border-accent-blue/30 bg-accent-blue/5">
                                    <p className="text-xs font-bold text-navy mb-2">{slotTch} · {slotSubj?.subject_name || '—'}</p>
                                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 items-center">
                                      <Select value={editDay} onChange={e => setEditDay(e.target.value)} options={dayOptions} placeholder="Day..." />
                                      <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 focus:border-accent-blue focus:outline-none text-sm" />
                                      <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 focus:border-accent-blue focus:outline-none text-sm" />
                                      <div className="flex gap-2">
                                        <Button size="sm" loading={updatingSlot} onClick={() => void handleUpdateSlot(slot.id)}>Save</Button>
                                        <Button size="sm" variant="secondary" onClick={() => setEditingSlotId(null)}>Cancel</Button>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div key={slot.id} className="premium-card flex items-center gap-3 p-3 flex-wrap">
                                    <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border', scheduled ? 'bg-white border-gray-100 text-accent-blue' : 'bg-amber-50 border-amber-100 text-amber-500')}>
                                      <CalendarClock className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-navy truncate">{slotTch} · {slotSubj?.subject_name || '—'}</p>
                                      {scheduled ? (
                                        <p className="text-[11px] text-gray-400">{slot.day_of_week} · {formatSlotTime(slot.start_time!)} – {formatSlotTime(slot.end_time!)}</p>
                                      ) : (
                                        <p className="text-[11px] text-amber-600 font-semibold">Unscheduled — set a day & time</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <IconButton title="Edit slot" onClick={() => startEditSlot(slot)}>
                                        <Pencil className="w-4 h-4" />
                                      </IconButton>
                                      <IconButton title="Delete slot" variant="danger" onClick={() => void handleDeleteSlot(slot.id)} disabled={deletingSlotId === slot.id}>
                                        {deletingSlotId === slot.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                      </IconButton>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}