import { useEffect, useState, useCallback, useRef } from 'react'
import { useTeacherGuard } from '@/hooks/useTeacherGuard'
import { useToast } from '@/components/ui/Toast'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants'
import {
  supabase, fetchTeacherTimetable, fetchAllSubjects, fetchAllProfiles,
  fetchPublishedNotes, fetchTeacherNotes, createNoteRecord, fetchSubjectTodos, createTodo,
  deleteNote, fetchActiveSessions, startLiveSession, pingLiveSession,
  endLiveSession, endLiveSessionBySessionId, forceEndLiveSession,
  publishNote, updateTodoDetails, deleteTodo,
} from '@/lib/supabase'
import { formatDate, getColorForIndex, getGreeting } from '@/lib/helpers'
import { COLOR_PALETTE } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Select'
import AppHeader from '@/components/AppHeader'
import AudioRecorder from '@/components/AudioRecorder'
import type { Subject, DailyNote, NotesContent, QuizContent, TeacherTimetable, ActiveSession, GlobalTodo } from '@/lib/types'
import { generatePDF, buildPaperHTML } from '@/lib/pdfUtils'
import {
  Mic, FileText, BookOpen,
  Calendar, ChevronRight, ListTodo, FileQuestion,
  Eye, Trash2, X, Download, Loader2,
  Lock, Radio, Zap, AlertTriangle, Square, RotateCcw, CalendarClock, Clock, Plus,
  Send, Pencil, MonitorSmartphone,
} from 'lucide-react'
import { clsx } from 'clsx'

interface TeacherSubject extends Subject {
  noteCount: number
  colorIndex: number
}

/** A recording whose tab closed before notes were generated — the transcript
 *  survives in the database and notes can still be made from it. */
interface UnprocessedTranscript {
  id: string
  session_id: string
  subject_id: string | null
  chunk_count: number
  accumulated_text: string
  updated_at: string
}

/** Minimal Screen Wake Lock typing (not yet in TypeScript's DOM lib). */
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: string, listener: () => void) => void
}

type TodoTypeKey = 'assignment' | 'quiz' | 'reading' | 'custom'

const TODO_TYPE_META: Record<TodoTypeKey, { label: string; pill: string }> = {
  assignment: { label: 'Assignment', pill: 'bg-accent-blue/10 text-accent-blue' },
  quiz: { label: 'Quiz', pill: 'bg-purple-500/10 text-purple-500' },
  reading: { label: 'Reading', pill: 'bg-amber-500/10 text-amber-600' },
  custom: { label: 'Custom', pill: 'bg-navy/10 text-navy' },
}

/* ── Live classroom constants ── */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SLOT_GRACE_MINUTES = 10 // wrap-up time after the scheduled end
const HEARTBEAT_MS = 15000
const STALE_MS = 120000 // must match the 2-minute staleness window in migration 003

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function formatClock(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' })
}

function formatElapsed(startedIso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedIso).getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'starting now'
  if (minutes < 60) return `in ${minutes} min`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
  }
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  return h > 0 ? `in ${d}d ${h}h` : `in ${d}d`
}

/** "09:30" → "9:30 AM" */
function formatSlotTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = (h || 0) >= 12 ? 'PM' : 'AM'
  const hr = (h || 0) % 12 || 12
  return `${hr}:${(m || 0).toString().padStart(2, '0')} ${ampm}`
}

function addMinutes(t: string, minutes: number): string {
  const total = toMinutes(t) + minutes
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export default function TeacherDashboard() {
  const { verified, user, profile } = useTeacherGuard()
  const { success: toastSuccess, error: toastError } = useToast()
  const [subjects, setSubjects] = useState<TeacherSubject[]>([])
  const [recentNotes, setRecentNotes] = useState<DailyNote[]>([])
  const [allSubjects, setAllSubjects] = useState<Subject[]>([])
  const [timetable, setTimetable] = useState<TeacherTimetable[]>([])
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [processingSession, setProcessingSession] = useState(false)
  const [totalTodos, setTotalTodos] = useState(0)

  // ── Live classroom state (timetable-driven recording + part locks) ──
  const [liveSubjectId, setLiveSubjectId] = useState<string | null>(null)
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [liveRowId, setLiveRowId] = useState<string | null>(null)
  const [recorderStatus, setRecorderStatus] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle')
  const [startingClass, setStartingClass] = useState(false)
  const [confirmForceUnlock, setConfirmForceUnlock] = useState(false)
  const [forceUnlockBusy, setForceUnlockBusy] = useState(false)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [liveStartedAt, setLiveStartedAt] = useState<string | null>(null)
  // Scheduled end of the slot the live class belongs to — drives the auto-end
  const [liveSlotEnd, setLiveSlotEnd] = useState<string | null>(null)
  // Incremented to command the recorder to stop (scheduled time ran out)
  const [autoStopSignal, setAutoStopSignal] = useState(0)
  const autoEndedRef = useRef(false)
  // True while we intentionally end our own lock (suppresses kick detection)
  const endingOwnSessionRef = useRef(false)

  // Generate Paper Modal state
  const [showPaperModal, setShowPaperModal] = useState(false)
  const [paperSubject, setPaperSubject] = useState('')
  const [paperDateMode, setPaperDateMode] = useState<'all' | 'range'>('all')
  const [paperDateFrom, setPaperDateFrom] = useState('')
  const [paperDateTo, setPaperDateTo] = useState('')
  const [paperType, setPaperType] = useState<'mcq' | 'short' | 'long' | 'short-long' | 'combined' | 'custom'>('combined')
  const [paperGenerating, setPaperGenerating] = useState(false)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [mcqCount, setMcqCount] = useState(10)
  const [shortCount, setShortCount] = useState(4)
  const [longCount, setLongCount] = useState(2)

  // Assign Task (manual to-do) modal state
  const [showTodoModal, setShowTodoModal] = useState(false)
  const [todoSubject, setTodoSubject] = useState('')
  const [todoTask, setTodoTask] = useState('')
  const [todoType, setTodoType] = useState<'assignment' | 'quiz' | 'reading' | 'custom'>('assignment')
  const [todoDeadline, setTodoDeadline] = useState('')
  const [todoSaving, setTodoSaving] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Note preview
  const [previewNote, setPreviewNote] = useState<DailyNote | null>(null)

  // Draft review & publish flow
  const [draftNotes, setDraftNotes] = useState<DailyNote[]>([])
  const [publishingNote, setPublishingNote] = useState(false)

  // Recordings that ended before their notes were generated (tab closed etc.)
  const [unprocessed, setUnprocessed] = useState<UnprocessedTranscript[]>([])
  const [recoveringSessionId, setRecoveringSessionId] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<string | null>(null)

  // Existing-task management (edit / delete tasks already assigned)
  const [todoList, setTodoList] = useState<GlobalTodo[]>([])
  const [todoListLoading, setTodoListLoading] = useState(false)
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [editTask, setEditTask] = useState('')
  const [editType, setEditType] = useState<TodoTypeKey>('assignment')
  const [editDeadline, setEditDeadline] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deletingTodoId, setDeletingTodoId] = useState<string | null>(null)

  // Full dashboard refresh — subjects with note counts, recent notes (drafts
  // included), todo count, and any recordings still waiting to become notes.
  const reloadDashboardData = useCallback(async () => {
    if (!user) return
    const [timetableData, allSubjectsData, activeSessionsData, profilesData] = await Promise.all([
      fetchTeacherTimetable(user.id),
      fetchAllSubjects(),
      fetchActiveSessions(),
      fetchAllProfiles(),
    ])

    setTimetable(timetableData)
    setAllSubjects(allSubjectsData)
    setActiveSessions(activeSessionsData)
    setTeacherNames(Object.fromEntries(profilesData.map(p => [p.id, p.full_name])))

    const teacherSubjects = allSubjectsData.filter(s =>
      timetableData.some(t => t.subject_id === s.id)
    )

    // Drafts included — the teacher sees their own unpublished notes
    const notesPerSubject = await Promise.all(
      teacherSubjects.map(s => fetchTeacherNotes(s.id))
    )
    setSubjects(teacherSubjects.map((subject, index) => {
      const notes = notesPerSubject[index] || []
      return {
        ...subject,
        noteCount: notes.filter(n => n.is_published).length,
        colorIndex: index,
      }
    }))

    const allNotes = notesPerSubject.flat()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setRecentNotes(allNotes.slice(0, 6))
    setDraftNotes(allNotes.filter(n => !n.is_published).slice(0, 5))

    const todosArrays = await Promise.all(
      teacherSubjects.map(s => fetchSubjectTodos(s.id))
    )
    setTotalTodos(todosArrays.flat().length)

    // Leftover transcripts = classes that never finished processing
    const { data: transcripts } = await supabase
      .from('session_transcripts')
      .select('id, session_id, subject_id, chunk_count, accumulated_text, updated_at')
      .eq('teacher_id', user.id)
      .gte('updated_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(5)
    setUnprocessed((transcripts || []) as UnprocessedTranscript[])
  }, [user])

  useEffect(() => {
    if (!verified || !user) return

    setLoading(true)
    void reloadDashboardData().finally(() => setLoading(false))
  }, [verified, user, reloadDashboardData])

  /* ── Live classroom: lock refresh, heartbeat, realtime ── */
  const refreshLiveSessions = useCallback(async () => {
    const sessions = await fetchActiveSessions()
    setActiveSessions(sessions)
  }, [])

  // 1-second clock drives live elapsed timers and countdowns
  useEffect(() => {
    const i = setInterval(() => setClockNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  // Poll lock freshness (realtime below covers instant changes)
  useEffect(() => {
    if (!verified) return
    const i = setInterval(() => { void refreshLiveSessions() }, 15000)
    return () => clearInterval(i)
  }, [verified, refreshLiveSessions])

  // Instant lock updates from other teachers / admin force-ends
  useEffect(() => {
    if (!verified) return
    const ch = supabase
      .channel('teacher-active-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, () => {
        void refreshLiveSessions()
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [verified, refreshLiveSessions])

  // Heartbeat — keeps our part-lock alive while the recorder runs
  useEffect(() => {
    if (!liveRowId) return
    if (recorderStatus !== 'recording' && recorderStatus !== 'paused' && recorderStatus !== 'processing') return
    void pingLiveSession(liveRowId)
    const i = setInterval(() => { void pingLiveSession(liveRowId) }, HEARTBEAT_MS)
    return () => clearInterval(i)
  }, [liveRowId, recorderStatus])

  /* ── Keep the screen awake while the class records and the notes are being
       made. The Wake Lock API holds the display on regardless of the device's
       screen-timeout setting (15s, 30s, … on mobile or PC) and is released as
       soon as the notes are ready — the normal display timer then takes over. */
  const recorderStatusRef = useRef(recorderStatus)
  useEffect(() => { recorderStatusRef.current = recorderStatus }, [recorderStatus])

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const wakeBusyRef = useRef(false)

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    if (!nav.wakeLock || wakeLockRef.current) return
    try {
      const sentinel = await nav.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null
      })
    } catch {
      // Unsupported or denied (e.g. battery saver) — recording continues fine
    }
  }, [])

  useEffect(() => {
    const busy = recorderStatus !== 'idle' || processingSession
    wakeBusyRef.current = busy
    if (busy) {
      void requestWakeLock()
    } else {
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
    }
  }, [recorderStatus, processingSession, requestWakeLock])

  // Browsers drop the lock whenever the tab is hidden — re-grab on return
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wakeBusyRef.current) {
        void requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [requestWakeLock])

  // Last-chance warning before closing the tab mid-class — closing stops the
  // mic, and the recording can then only be recovered from the Unprocessed
  // recordings card after reloading.
  useEffect(() => {
    const busy = recorderStatus !== 'idle' || processingSession
    if (!busy) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [recorderStatus, processingSession])

  const handleStartClass = useCallback(async (slot: TeacherTimetable) => {
    if (!user) return
    setStartingClass(true)
    try {
      const sid = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const res = await startLiveSession(user.id, slot.subject_id, sid)
      if (res.error || !res.row) {
        toastError(res.error || 'Could not start the class')
        void refreshLiveSessions()
        return
      }
      setLiveSubjectId(slot.subject_id)
      setLiveSessionId(sid)
      setLiveRowId(res.row.id)
      setLiveStartedAt(new Date().toISOString())
      setLiveSlotEnd(slot.end_time ?? null)
      autoEndedRef.current = false
      setAutoStopSignal(0)
      setRecorderStatus('recording')
      toastSuccess('You are live — recording started')
      void refreshLiveSessions()
    } finally {
      setStartingClass(false)
    }
  }, [user, refreshLiveSessions, toastSuccess, toastError])

  const handleCancelLiveClass = useCallback(async (opts?: { sessionId?: string; rowId?: string }) => {
    endingOwnSessionRef.current = true
    const sid = opts?.sessionId ?? liveSessionId
    const rid = opts?.rowId ?? liveRowId
    if (sid) await endLiveSessionBySessionId(sid)
    else if (rid) await endLiveSession(rid)
    setLiveSubjectId(null)
    setLiveSessionId(null)
    setLiveRowId(null)
    setLiveStartedAt(null)
    setLiveSlotEnd(null)
    autoEndedRef.current = false
    setRecorderStatus('idle')
    void refreshLiveSessions()
    toastSuccess('Class ended — recording discarded')
    // Re-arm kick detection once in-flight realtime checks settle
    setTimeout(() => { endingOwnSessionRef.current = false }, 4000)
  }, [liveSessionId, liveRowId, refreshLiveSessions, toastSuccess])

  /* ── Derived live-classroom values (recomputed as the clock ticks) ── */
  const nowDate = new Date(clockNow)
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  const todayName = DAY_NAMES[nowDate.getDay()]
  const subjectById = new Map<string, Subject>(allSubjects.map(s => [s.id, s] as [string, Subject]))

  // Today's scheduled slots (legacy assignments without day/time are ignored)
  const todaySlots = timetable
    .filter(t => t.day_of_week === todayName && t.start_time && t.end_time)
    .sort((a, b) => toMinutes(a.start_time!) - toMinutes(b.start_time!))

  // My slot whose window [start, end + grace) contains "now"
  const currentSlot = todaySlots.find(t =>
    nowMinutes >= toMinutes(t.start_time!) &&
    nowMinutes < toMinutes(t.end_time!) + SLOT_GRACE_MINUTES
  ) ?? null
  const currentSubject = currentSlot ? subjectById.get(currentSlot.subject_id) ?? null : null
  const currentPart = currentSubject?.part ?? null

  // Part-lock: another teacher currently live in the same part
  const partLock = (currentPart && user)
    ? activeSessions.find(s => s.is_active && s.part === currentPart && s.teacher_id !== user.id) ?? null
    : null
  const partLockStale = partLock
    ? clockNow - new Date(partLock.last_ping || partLock.started_at).getTime() > STALE_MS
    : false

  // Our own live row — shows the crash-recovery banner after a reload
  const ownLiveSession = user
    ? activeSessions.find(s => s.teacher_id === user.id && s.is_active) ?? null
    : null

  // Next upcoming slot within the next 7 days (drives the idle countdown)
  const nextSlotInfo = (() => {
    const candidates: { slot: TeacherTimetable; dayOffset: number; minutesUntil: number }[] = []
    for (let offset = 0; offset < 7; offset++) {
      const dayName = DAY_NAMES[new Date(clockNow + offset * 86400000).getDay()]
      for (const t of timetable) {
        if (t.day_of_week !== dayName || !t.start_time || !t.end_time) continue
        if (offset === 0 && toMinutes(t.start_time) <= nowMinutes) continue
        candidates.push({ slot: t, dayOffset: offset, minutesUntil: offset * 1440 + toMinutes(t.start_time) - nowMinutes })
      }
    }
    candidates.sort((a, b) => a.minutesUntil - b.minutesUntil)
    const first = candidates[0]
    if (!first) return null
    const dayLabel = first.dayOffset === 0 ? 'today'
      : first.dayOffset === 1 ? 'tomorrow'
      : DAY_NAMES[new Date(clockNow + first.dayOffset * 86400000).getDay()]
    return { ...first, dayLabel }
  })()

  /* ── Auto-end: once the slot's wrap-up grace is fully over, the recording
       stops itself — a class cannot keep running past its scheduled time.
       Stopping mid-recording follows the normal “Stop & Process” path, so
       the notes are still generated from everything recorded so far. ── */
  useEffect(() => {
    if (!liveSlotEnd || autoEndedRef.current) return
    if (recorderStatus !== 'recording' && recorderStatus !== 'paused') return
    if (nowMinutes < toMinutes(liveSlotEnd) + SLOT_GRACE_MINUTES) return
    autoEndedRef.current = true
    setAutoStopSignal(n => n + 1)
    toastError('Scheduled time is over — the class ended automatically')
  }, [clockNow, liveSlotEnd, recorderStatus, nowMinutes, toastError])

  const handleForceUnlock = useCallback(async () => {
    if (!partLock) return
    setForceUnlockBusy(true)
    try {
      const ok = await forceEndLiveSession(partLock.id, profile?.full_name || 'A teacher')
      if (ok) {
        setConfirmForceUnlock(false)
        toastSuccess('Stale session ended — the part is free now')
        void refreshLiveSessions()
      } else {
        toastError('Could not end that session — it looks active again')
      }
    } finally {
      setForceUnlockBusy(false)
    }
  }, [partLock, profile, refreshLiveSessions, toastSuccess, toastError])

  const handleResumeLiveClass = useCallback(() => {
    if (!ownLiveSession) return
    setLiveSubjectId(ownLiveSession.subject_id)
    setLiveSessionId(ownLiveSession.session_id)
    setLiveRowId(ownLiveSession.id)
    setLiveStartedAt(ownLiveSession.started_at)
    // Re-attach the scheduled limit so auto-end still applies after a resume
    const slot = timetable.find(t =>
      t.day_of_week === todayName && t.subject_id === ownLiveSession.subject_id && t.end_time
    )
    setLiveSlotEnd(slot?.end_time ?? null)
    autoEndedRef.current = false
    setAutoStopSignal(0)
    setRecorderStatus('recording')
    toastSuccess('Resumed your live class')
  }, [ownLiveSession, timetable, todayName, toastSuccess])

  // Watch our own lock row — surface admin force-ends the instant they happen
  useEffect(() => {
    if (!liveRowId || !user) return
    const checkRow = async () => {
      if (endingOwnSessionRef.current) return
      const { data } = await supabase
        .from('active_sessions')
        .select('is_active, kicked_by')
        .eq('id', liveRowId)
        .maybeSingle()
      if (data && !data.is_active && !endingOwnSessionRef.current) {
        // Ended by an admin or another teacher. If the mic is still running we
        // follow the normal “Stop & Process” path — the teacher still gets the
        // notes for everything recorded so far (saved as a draft to review).
        if (recorderStatusRef.current !== 'idle') {
          toastError(data.kicked_by
            ? `Your class was ended by ${data.kicked_by} — generating your notes`
            : 'Your class has ended — generating your notes')
          autoEndedRef.current = true
          setAutoStopSignal(n => n + 1)
          return
        }
        toastError(data.kicked_by
          ? `Your live class was ended by ${data.kicked_by}`
          : 'Your live class has ended')
        setLiveSubjectId(null)
        setLiveSessionId(null)
        setLiveRowId(null)
        setLiveStartedAt(null)
        setLiveSlotEnd(null)
        autoEndedRef.current = false
        setRecorderStatus('idle')
      }
    }
    const ch = supabase
      .channel(`own-lock-${liveRowId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'active_sessions', filter: `id=eq.${liveRowId}` },
        () => { void checkRow() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [liveRowId, user, toastError])

  /* ── Transcript → draft note ──
     Shared by the live “Stop & Process” path and the Unprocessed-recordings
     recovery: calls the edge function, saves the note as a DRAFT (students
     can't see it yet) and creates the AI tasks. The teacher then reviews
     everything in the preview modal and publishes with one tap. */
  const processTranscriptIntoDraft = useCallback(async (
    subjectId: string,
    sessionId: string,
  ): Promise<DailyNote | null> => {
    if (!user) return null

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token || SUPABASE_ANON_KEY

    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-full-transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        sessionId,
        subjectId,
        teacherId: user.id,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Server error (${response.status})`)
    }
    if (!data?.success) {
      throw new Error(data?.error || 'Transcription processing failed')
    }
    if (!data?.notesContent || !data?.quizContent) {
      throw new Error('The recording was too short to make notes')
    }

    // DRAFT first — the teacher previews the notes and tasks before the
    // note goes live to students.
    const note = await createNoteRecord(
      subjectId,
      user.id,
      new Date().toISOString(),
      data.notesContent,
      data.quizContent,
      false,
    )
    if (!note) throw new Error('Could not save the note')

    // Auto-create todos from the AI response (both notes and quiz todos)
    const notesContent = data.notesContent as NotesContent
    const quizContent = data.quizContent as QuizContent
    const allTodos = [
      ...(notesContent.todos || []),
      ...(quizContent.todos || []),
    ]
    if (allTodos.length > 0) {
      await Promise.all(allTodos.map(todo =>
        createTodo(
          subjectId,
          todo.task,
          todo.type || 'custom',
          todo.deadline || undefined,
          user.id,
        )
      ))
    }

    return note
  }, [user])

  const handleRecordingComplete = useCallback(async (sessionId: string) => {
    if (!liveSubjectId || !user) return

    // The microphone is off — release the part-lock right away so the next
    // teacher can start while the transcript is still being processed.
    endingOwnSessionRef.current = true
    if (liveRowId) await endLiveSession(liveRowId)
    else await endLiveSessionBySessionId(sessionId)
    setLiveRowId(null)
    setLiveSlotEnd(null)
    autoEndedRef.current = false
    void refreshLiveSessions()
    setTimeout(() => { endingOwnSessionRef.current = false }, 4000)

    setProcessingSession(true)
    try {
      const note = await processTranscriptIntoDraft(liveSubjectId, sessionId)
      if (note) {
        toastSuccess('Draft ready — review the notes, then publish')
        setPreviewNote(note)
      }
      await reloadDashboardData()
    } catch (err: any) {
      console.error('Full transcript processing error:', err)
      toastError(`Processing error: ${err.message}`)
      // The transcript stays saved — the Unprocessed recordings card offers a retry
      await reloadDashboardData()
    } finally {
      setLiveSubjectId(null)
      setLiveSessionId(null)
      setLiveStartedAt(null)
      setRecorderStatus('idle')
      setProcessingSession(false)
    }
  }, [liveSubjectId, liveRowId, user, refreshLiveSessions, processTranscriptIntoDraft, reloadDashboardData, toastSuccess, toastError])

  /* ── Recovery: make notes from a recording whose tab closed ── */
  const handleRecoverTranscript = useCallback(async (t: UnprocessedTranscript) => {
    if (!user || !t.subject_id) return
    setRecoveringSessionId(t.session_id)
    try {
      const note = await processTranscriptIntoDraft(t.subject_id, t.session_id)
      if (note) {
        toastSuccess('Draft ready — review the notes, then publish')
        setPreviewNote(note)
      }
    } catch (err: any) {
      toastError(`Could not make notes: ${err.message}`)
    } finally {
      setRecoveringSessionId(null)
      await reloadDashboardData()
    }
  }, [user, processTranscriptIntoDraft, reloadDashboardData, toastSuccess, toastError])

  const handleDiscardTranscript = useCallback(async (id: string) => {
    await supabase.from('session_transcripts').delete().eq('id', id)
    setUnprocessed(prev => prev.filter(t => t.id !== id))
    setDiscardTarget(null)
    toastSuccess('Recording discarded')
  }, [toastSuccess])

  // Handle Generate Paper
  const handleGeneratePaper = useCallback(async () => {
    if (!paperSubject) {
      toastError('Please select a subject')
      return
    }

    setPaperGenerating(true)
    try {
      // Fetch notes for the selected subject
      const notes = await fetchPublishedNotes(paperSubject)
      
      // Filter by date range if selected
      let filteredNotes = notes
      if (paperDateMode === 'range' && paperDateFrom && paperDateTo) {
        filteredNotes = notes.filter(n => {
          const noteDate = n.lecture_date.split('T')[0]
          return noteDate >= paperDateFrom && noteDate <= paperDateTo
        })
      }

      if (filteredNotes.length === 0) {
        toastError('No notes found for the selected criteria')
        setPaperGenerating(false)
        return
      }

      // Merge all notes content
      const mergedContent = {
        sections_en: filteredNotes.flatMap(n => n.notes_content?.sections_en || []),
        sections: filteredNotes.flatMap(n => n.notes_content?.sections || []),
        summary_en: filteredNotes.map(n => n.notes_content?.summary_en).filter(Boolean).join(' '),
        summary: filteredNotes.map(n => n.notes_content?.summary).filter(Boolean).join(' '),
      }

      const subject = subjects.find(s => s.id === paperSubject)

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || SUPABASE_ANON_KEY
      
      // Build request body with custom counts if in custom mode
      const requestBody: any = {
        notesContent: mergedContent,
        subjectName: subject?.subject_name || 'Subject',
        paperType,
        extraInstructions: extraInstructions || undefined,
      }
      if (paperType === 'custom') {
        requestBody.customCounts = { mcqs: mcqCount, shortAnswers: shortCount, longAnswers: longCount }
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-question-paper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()
      if (data?.questionPaper) {
        const paper = data.questionPaper
        const paperLabel = paperType === 'custom' ? 'custom' : paperType

        // Generate PDF
        const html = buildPaperHTML({
          subjectName: subject?.subject_name || 'Exam',
          date: new Date().toLocaleDateString(),
          paperType: paperLabel.charAt(0).toUpperCase() + paperLabel.slice(1),
          totalMarks: paper.totalMarks,
          durationMinutes: paper.durationMinutes,
          mcqs: paper.mcqs,
          shortAnswers: paper.shortAnswers,
          longAnswers: paper.longAnswers,
        })

        await generatePDF(html, {
          filename: `${subject?.subject_code || 'exam'}-paper-${paperLabel}-${new Date().toISOString().split('T')[0]}.pdf`,
        })

        toastSuccess(`Question paper generated! (${filteredNotes.length} lecture${filteredNotes.length > 1 ? 's' : ''})`)
        setShowPaperModal(false)
      } else {
        toastError('Failed to generate question paper')
      }
    } catch (err: any) {
      toastError(`Paper generation error: ${err.message}`)
    } finally {
      setPaperGenerating(false)
    }
  }, [paperSubject, paperDateMode, paperDateFrom, paperDateTo, paperType, extraInstructions, mcqCount, shortCount, longCount, subjects, toastSuccess, toastError])

  // Handle Delete Note
  const handleDeleteNote = useCallback(async (noteId: string) => {
    setDeleting(true)
    try {
      await deleteNote(noteId)
      toastSuccess('Note deleted successfully')
      setDeleteTarget(null)
      setPreviewNote(prev => prev?.id === noteId ? null : prev)
      // Refresh notes
      setRecentNotes(prev => prev.filter(n => n.id !== noteId))
      setDraftNotes(prev => prev.filter(n => n.id !== noteId))
    } catch (err: any) {
      toastError(`Delete error: ${err.message}`)
    } finally {
      setDeleting(false)
    }
  }, [toastSuccess, toastError])

  // Publish a reviewed draft — students get the notes, quiz and tasks instantly
  const handlePublishNote = useCallback(async () => {
    if (!previewNote) return
    setPublishingNote(true)
    try {
      const ok = await publishNote(previewNote.id)
      if (!ok) {
        toastError('Could not publish — please try again')
        return
      }
      setPreviewNote(prev => prev ? { ...prev, is_published: true } : null)
      toastSuccess('Published — students can now open the notes')
      await reloadDashboardData()
    } finally {
      setPublishingNote(false)
    }
  }, [previewNote, reloadDashboardData, toastSuccess, toastError])

  // ── Manual to-do creation (works anytime — no live lecture needed) ──
  // NOTE: must stay ABOVE the `if (!verified) return null` guard — React
  // requires every hook to run on every render in the same order.
  const refreshTodoCount = useCallback(async () => {
    if (!subjects.length) return
    const todosArrays = await Promise.all(subjects.map(s => fetchSubjectTodos(s.id)))
    setTotalTodos(todosArrays.flat().length)
  }, [subjects])

  const handleCreateTodo = useCallback(async () => {
    if (!user) return
    const trimmed = todoTask.trim()
    if (!todoSubject || !trimmed) {
      toastError('Pick a subject and write the task first')
      return
    }
    setTodoSaving(true)
    try {
      const ok = await createTodo(todoSubject, trimmed, todoType, todoDeadline || undefined, user.id)
      if (!ok) {
        toastError('Could not create the task — please try again')
        return
      }
      const subjectName = subjects.find(s => s.id === todoSubject)?.subject_name || 'the subject'
      toastSuccess(`Task assigned to students of ${subjectName}`)
      setShowTodoModal(false)
      setTodoSubject('')
      setTodoTask('')
      setTodoType('assignment')
      setTodoDeadline('')
      void refreshTodoCount()
    } finally {
      setTodoSaving(false)
    }
  }, [user, todoSubject, todoTask, todoType, todoDeadline, subjects, refreshTodoCount, toastSuccess, toastError])

  // Load existing tasks whenever the Assign Task modal opens (for editing)
  useEffect(() => {
    if (!showTodoModal || subjects.length === 0) return
    let cancelled = false
    const load = async () => {
      setTodoListLoading(true)
      try {
        const arrays = await Promise.all(subjects.map(s => fetchSubjectTodos(s.id)))
        if (cancelled) return
        setTodoList(
          arrays.flat()
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 8)
        )
      } finally {
        if (!cancelled) setTodoListLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [showTodoModal, subjects])

  const handleUpdateTodo = useCallback(async (todo: GlobalTodo) => {
    const trimmed = editTask.trim()
    if (!trimmed) {
      toastError('Write the task first')
      return
    }
    setEditSaving(true)
    try {
      const ok = await updateTodoDetails(todo.id, {
        task_description: trimmed,
        todo_type: editType,
        deadline: editDeadline || null,
      })
      if (!ok) {
        toastError('Could not save — please try again')
        return
      }
      setTodoList(prev => prev.map(t =>
        t.id === todo.id
          ? { ...t, task_description: trimmed, todo_type: editType, deadline: editDeadline || undefined }
          : t
      ))
      setEditingTodoId(null)
      toastSuccess('Task updated for all students')
    } finally {
      setEditSaving(false)
    }
  }, [editTask, editType, editDeadline, toastSuccess, toastError])

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    const ok = await deleteTodo(todoId)
    if (!ok) {
      toastError('Could not delete — please try again')
      return
    }
    setTodoList(prev => prev.filter(t => t.id !== todoId))
    setDeletingTodoId(null)
    setTotalTodos(prev => Math.max(0, prev - 1))
    toastSuccess('Task removed')
  }, [toastSuccess, toastError])

  if (!verified) return null

  const totalNotes = subjects.reduce((acc, s) => acc + s.noteCount, 0)

  const subjectOptions = subjects.map(s => ({
    value: s.id,
    label: `${s.subject_name} (${s.subject_code})`,
  }))

  return (
    <div className="min-h-screen bg-accent-light">
      <AppHeader portalName="Teacher Portal" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Premium Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl mb-6 sm:mb-8 animate-fade-up">
          <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy-light to-navy" />
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
          <div className="absolute -top-32 -right-32 w-72 h-72 bg-accent-blue/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-56 h-56 bg-accent-purple/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="min-w-0">
                <p className="text-white/40 text-[11px] sm:text-xs font-medium mb-1.5 uppercase tracking-wider">{formatDate(new Date().toISOString())}</p>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white mb-2 leading-tight truncate">
                  {getGreeting()}, <span className="bg-gradient-to-r from-accent-blue to-purple-400 bg-clip-text text-transparent">{profile?.full_name?.split(' ')[0]}</span>
                </h1>
                <p className="text-white/50 text-xs sm:text-sm max-w-md truncate">Record lectures, publish notes, and manage your subjects.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button onClick={() => setShowTodoModal(true)}
                  className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-xs sm:text-sm font-semibold text-white transition-all border border-white/10 hover:border-white/20">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Assign Task</span>
                  <span className="sm:hidden">Task</span>
                </button>
                {totalNotes > 0 && (
                  <button onClick={() => setShowPaperModal(true)}
                    className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-xs sm:text-sm font-semibold text-white transition-all border border-white/10 hover:border-white/20">
                    <FileQuestion className="w-4 h-4" />
                    <span className="hidden sm:inline">Generate Paper</span>
                    <span className="sm:hidden">Paper</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Premium Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <StatCard label="Subjects" value={subjects.length} gradient="from-blue-500 to-blue-600" icon={<BookOpen className="w-5 h-5" />} accent="stat-blue" />
          <StatCard label="Published Notes" value={totalNotes} gradient="from-emerald-500 to-emerald-600" icon={<FileText className="w-5 h-5" />} accent="stat-green" />
          <StatCard label="To-Dos Created" value={totalTodos} gradient="from-purple-500 to-purple-600" icon={<ListTodo className="w-5 h-5" />} accent="stat-purple" />
          <StatCard label="Recent Activity" value={recentNotes.length} gradient="from-amber-500 to-amber-600" icon={<Calendar className="w-5 h-5" />} accent="stat-amber" />
        </div>

        {/* Drafts waiting for review — students can't see these yet */}
        {draftNotes.length > 0 && recorderStatus === 'idle' && !processingSession && (
          <div className="mb-6 sm:mb-8 rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50/80 via-white to-white p-4 sm:p-5 flex items-center gap-3 sm:gap-4 flex-wrap animate-fade-up shadow-sm">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 shadow-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-navy text-sm">
                {draftNotes.length} note{draftNotes.length > 1 ? 's' : ''} waiting for review
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {draftNotes.length > 1 ? 'Check the notes and publish when ready.' : 'Review and publish when ready.'}
              </p>
            </div>
            <Button size="sm" variant="primary" onClick={() => setPreviewNote(draftNotes[0])} className="shrink-0">
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Review & Publish</span>
              <span className="sm:hidden">Review</span>
            </Button>
          </div>
        )}

        {/* Live Classroom — timetable-driven recording with part-locks */}
        <Card className="mb-6 sm:mb-8 border border-gray-100 premium-card">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-accent-blue to-accent-purple rounded-2xl flex items-center justify-center shadow-lg shadow-accent-blue/20">
                <CalendarClock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-navy">Live Classroom</h2>
                <p className="text-xs sm:text-sm text-gray-400 truncate">Mic unlocks during your scheduled slot</p>
              </div>
            </div>
            <Badge color="navy">{todayName}</Badge>
          </div>

          {liveSessionId && liveSubjectId && user ? (
            /* ── Recording in progress ── */
            <div className="rounded-2xl bg-navy p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-red-500/15 rounded-full blur-3xl pointer-events-none" />
              <div className="relative flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      Live now · Part {subjectById.get(liveSubjectId)?.part || '—'}
                    </p>
                    <p className="font-bold text-white">
                      {subjectById.get(liveSubjectId)?.subject_name || 'Your class'}
                    </p>
                  </div>
                </div>
                {liveStartedAt && (
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Elapsed</p>
                    <p className="font-mono text-lg font-bold text-white tabular-nums">
                      {formatElapsed(liveStartedAt, clockNow)}
                    </p>
                  </div>
                )}
              </div>

              {liveSlotEnd && nowMinutes >= toMinutes(liveSlotEnd) && recorderStatus !== 'processing' && (
                <div className="mb-4 rounded-xl bg-amber-400/15 border border-amber-300/25 px-4 py-2.5 flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                  <p className="text-amber-200/90 text-xs font-semibold">
                    Class time is over — recording will auto-end at {formatSlotTime(addMinutes(liveSlotEnd, SLOT_GRACE_MINUTES))}
                  </p>
                </div>
              )}

              <AudioRecorder
                key={liveSessionId}
                subjectId={liveSubjectId}
                teacherId={user.id}
                sessionId={liveSessionId}
                autoStart
                stopSignal={autoStopSignal}
                onStatusChange={setRecorderStatus}
                onRecordingComplete={handleRecordingComplete}
              />

              {(recorderStatus !== 'processing' && !processingSession) && (
                <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                  <button
                    onClick={() => void handleCancelLiveClass()}
                    className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-white/50 hover:text-red-300 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    End class & discard
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] text-white/40">
                    <MonitorSmartphone className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Screen stays awake until notes are ready</span>
                    <span className="sm:hidden">Screen stays awake</span>
                  </span>
                </div>
              )}
            </div>
          ) : ownLiveSession ? (
            /* ── Crash recovery: class still marked live after a reload ── */
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
              <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-navy text-sm">Unfinished class detected</h3>
                    <Badge color="yellow">Part {ownLiveSession.part || '—'}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 break-words">
                    {subjectById.get(ownLiveSession.subject_id)?.subject_name || 'Your subject'} — live since {formatClock(ownLiveSession.started_at)} ({formatElapsed(ownLiveSession.started_at, clockNow)}).
                  </p>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <Button size="sm" variant="primary" onClick={handleResumeLiveClass} className="flex-1 sm:flex-none">
                      <RotateCcw className="w-4 h-4" />
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleCancelLiveClass({ sessionId: ownLiveSession.session_id, rowId: ownLiveSession.id })}
                      className="flex-1 sm:flex-none"
                    >
                      <Square className="w-4 h-4" />
                      End & Free Part
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : currentSlot && currentSubject ? (
            partLock ? (
              /* ── Locked: another teacher is live in this part ── */
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5 sm:p-8 text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center mb-4">
                  <Lock className="w-7 h-7 text-gray-400" />
                </div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                  Part {currentPart} is live
                </div>
                <h3 className="font-bold text-navy text-sm sm:text-base">
                  {teacherNames[partLock.teacher_id] || 'Another teacher'} is teaching
                </h3>
                <p className="text-xs text-gray-400 mt-1 break-words">
                  {subjectById.get(partLock.subject_id)?.subject_name || 'Class'} · since {formatClock(partLock.started_at)} ({formatElapsed(partLock.started_at, clockNow)})
                </p>
                <p className="text-[11px] text-gray-400 mt-2 max-w-md mx-auto">
                  One class per part at a time — your mic unlocks when theirs ends.
                </p>
                {partLockStale ? (
                  confirmForceUnlock ? (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Button variant="danger" size="sm" loading={forceUnlockBusy} onClick={() => void handleForceUnlock()}>
                        Yes, force-unlock
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setConfirmForceUnlock(false)}>
                        Keep waiting
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmForceUnlock(true)}
                      className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      No heartbeat for 2+ minutes — force-unlock this stuck session
                    </button>
                  )
                ) : (
                  <p className="mt-3 text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Session healthy — unlocks automatically when it ends
                  </p>
                )}
              </div>
            ) : (
              /* ── Ready: it's this teacher's scheduled time — the brilliant mic ── */
              <div className="relative rounded-2xl border border-accent-blue/20 bg-gradient-to-br from-accent-blue/5 via-white to-accent-purple/5 p-5 sm:p-8 text-center overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent-blue via-accent-purple to-accent-blue" />
                <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-72 h-48 bg-accent-purple/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-blue/10 text-accent-blue text-[11px] font-bold uppercase tracking-widest mb-3">
                    <Zap className="w-3.5 h-3.5" />
                    It's your time
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-navy truncate">{currentSubject.subject_name}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatSlotTime(currentSlot.start_time!)} – {formatSlotTime(currentSlot.end_time!)} · Part {currentSubject.part}
                  </p>
                  {nowMinutes > toMinutes(currentSlot.end_time!) ? (
                    <p className="text-[11px] text-amber-600 font-semibold mt-1">
                      Grace period — wrap up before {formatSlotTime(addMinutes(currentSlot.end_time!, SLOT_GRACE_MINUTES))}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">
                      Wrap-up grace until {formatSlotTime(addMinutes(currentSlot.end_time!, SLOT_GRACE_MINUTES))}
                    </p>
                  )}

                  <div className="mt-5 sm:mt-6 flex flex-col items-center">
                    <button
                      onClick={() => void handleStartClass(currentSlot)}
                      disabled={startingClass}
                      className="group relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-accent-blue to-accent-purple text-white shadow-2xl shadow-accent-blue/40 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                    >
                      <span className="absolute -inset-2 sm:-inset-3 rounded-full border-2 border-accent-blue/30 animate-ping" />
                      <span className="absolute -inset-4 sm:-inset-6 rounded-full border border-accent-blue/20" />
                      {startingClass
                        ? <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin" />
                        : <Mic className="w-9 h-9 sm:w-11 sm:h-11 drop-shadow-lg transition-transform group-hover:scale-110" />}
                    </button>
                    <p className="mt-4 sm:mt-5 text-sm font-bold text-navy">
                      {startingClass ? 'Unlocking mic…' : 'Tap mic to go live'}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Part locks to you when you start
                    </p>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* ── Idle: no scheduled slot right now ── */
            <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 sm:p-8 text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center mb-4">
                <Mic className="w-6 h-6 sm:w-7 sm:h-7 text-gray-300" />
              </div>
              {nextSlotInfo ? (
                <>
                  <h3 className="font-bold text-navy text-sm sm:text-base">No class right now</h3>
                  <p className="text-xs text-gray-400 mt-1 break-words">
                    Next: {subjectById.get(nextSlotInfo.slot.subject_id)?.subject_name || 'Class'} · {nextSlotInfo.dayLabel} at {formatSlotTime(nextSlotInfo.slot.start_time!)} — {formatCountdown(nextSlotInfo.minutesUntil)}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-bold text-navy text-sm sm:text-base">No classes scheduled</h3>
                  <p className="text-xs text-gray-400 mt-1">Mic unlocks automatically during your slots.</p>
                </>
              )}
            </div>
          )}

          {/* ── Today's schedule ── */}
          {!liveSessionId && todaySlots.length > 0 && (
            <div className="mt-4 sm:mt-5 border-t border-gray-100 pt-4">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Today's schedule
              </p>
              <div className="space-y-2">
                {todaySlots.map(slot => {
                  const slotSubject = subjectById.get(slot.subject_id)
                  const isCurrent = currentSlot?.id === slot.id
                  const isPast = toMinutes(slot.end_time!) + SLOT_GRACE_MINUTES <= nowMinutes
                  return (
                    <div
                      key={slot.id}
                      className={clsx(
                        'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-colors',
                        isCurrent ? 'border-accent-blue/30 bg-accent-blue/5' : 'border-gray-100 bg-gray-50/50',
                        isPast && !isCurrent && 'opacity-55',
                      )}
                    >
                      <div className={clsx(
                        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                        isCurrent
                          ? 'bg-gradient-to-br from-accent-blue to-accent-purple text-white shadow-md shadow-accent-blue/20'
                          : 'bg-white border border-gray-100 text-gray-400',
                      )}>
                        {isCurrent ? <Mic className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-navy truncate">{slotSubject?.subject_name || 'Subject'}</p>
                        <p className="text-[10px] sm:text-[11px] text-gray-400">
                          {formatSlotTime(slot.start_time!)} – {formatSlotTime(slot.end_time!)}
                          {slotSubject ? ` · Part ${slotSubject.part}` : ''}
                        </p>
                      </div>
                      {isCurrent ? (
                        <Badge color="blue">Now</Badge>
                      ) : isPast ? (
                        <span className="text-[11px] text-gray-400 font-semibold">Done</span>
                      ) : (
                        <span className="text-[11px] text-gray-400 font-semibold">
                          {formatCountdown(toMinutes(slot.start_time!) - nowMinutes)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Unprocessed recordings — classes that ended before their notes were
            made (tab closed, browser crashed). The transcript survived, so the
            notes can still be generated from it. */}
        {unprocessed.length > 0 && !liveSessionId && recorderStatus === 'idle' && !processingSession && (
          <Card className="mb-6 sm:mb-8 border border-amber-200/70 premium-card">
            <div className="flex items-center gap-3 mb-4 sm:mb-5">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 border border-amber-200 rounded-2xl flex items-center justify-center">
                <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-navy">Unprocessed recordings</h2>
                <p className="text-xs sm:text-sm text-gray-400 truncate">Classes that ended before notes were made</p>
              </div>
            </div>
            <div className="space-y-2">
              {unprocessed.map(t => {
                const tSubject = subjectById.get(t.subject_id || '')
                const words = t.accumulated_text ? t.accumulated_text.trim().split(/\s+/).length : 0
                return (
                  <div key={t.id} className="flex items-center gap-3 px-3 sm:px-3.5 py-3 rounded-xl border border-gray-100 bg-gray-50/50 flex-wrap">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white border border-gray-100 text-gray-400 flex items-center justify-center shrink-0">
                      <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-navy truncate">{tSubject?.subject_name || 'Subject'}</p>
                      <p className="text-[10px] sm:text-[11px] text-gray-400 truncate">
                        Recorded {new Date(t.updated_at).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })} · {formatClock(t.updated_at)} · {t.chunk_count} chunks · ≈{words} words
                      </p>
                    </div>
                    {discardTarget === t.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void handleDiscardTranscript(t.id)}
                          className="px-2.5 py-2 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-all"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDiscardTarget(null)}
                          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleRecoverTranscript(t)}
                          disabled={recoveringSessionId !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-accent-blue hover:bg-accent-blue/90 transition-all disabled:opacity-50 shadow-md shadow-accent-blue/10"
                        >
                          {recoveringSessionId === t.session_id ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Making notes…</>
                          ) : (
                            <><Zap className="w-3.5 h-3.5" /> Generate Notes</>
                          )}
                        </button>
                        <button
                          onClick={() => setDiscardTarget(t.id)}
                          title="Discard recording"
                          className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Generating notes may take a minute — keep this tab open.</p>
          </Card>
        )}

        {/* Subjects */}
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <h2 className="text-base sm:text-lg font-bold text-navy">Your Subjects</h2>
          <span className="text-[11px] sm:text-xs text-gray-400 font-medium">{subjects.length} assigned</span>
        </div>
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} variant="card" className="h-40 sm:h-44" />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <div className="empty-state py-12">
            <BookOpen className="w-14 h-14 text-gray-200 mx-auto mb-4" />
            <h3 className="text-sm sm:text-base font-semibold text-gray-500">No subjects assigned</h3>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">Contact the administrator to get subjects assigned.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 mb-8 sm:mb-10">
            {subjects.map(subject => (
              <Card key={subject.id} hoverable className="premium-card group">
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base sm:text-lg shadow-md transition-transform group-hover:scale-105"
                    style={{ backgroundColor: getColorForIndex(subject.colorIndex, COLOR_PALETTE) }}
                  >
                    {subject.subject_name[0]}
                  </div>
                  <Badge color="blue">{subject.subject_code}</Badge>
                </div>
                <h3 className="font-bold text-navy text-sm sm:text-base mb-0.5 truncate">{subject.subject_name}</h3>
                <p className="text-[11px] sm:text-xs text-gray-400 mb-3 sm:mb-4">Part {subject.part}</p>
                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className="text-[11px] sm:text-xs text-gray-400 font-medium">{subject.noteCount} notes</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-accent-blue transition-colors" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Recent Notes */}
        {recentNotes.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4 sm:mb-5">
              <h2 className="text-base sm:text-lg font-bold text-navy">Recent Notes</h2>
              <span className="text-[11px] sm:text-xs text-gray-400 font-medium">Latest first</span>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {recentNotes.map(note => {
                const subject = subjects.find(s => s.id === note.subject_id)
                const createdDate = new Date(note.created_at)

                return (
                  <Card key={note.id} className="flex items-center gap-3 sm:gap-4 premium-card">
                    <div
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                      style={{ backgroundColor: subject ? getColorForIndex(subject.colorIndex, COLOR_PALETTE) : '#4A90D9' }}
                    >
                      <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate max-w-[120px] sm:max-w-none">
                          {subject?.subject_name || 'Subject'}
                        </span>
                        <Badge color={note.is_published ? 'green' : 'yellow'}>
                          {note.is_published ? 'Published' : 'Draft'}
                        </Badge>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-gray-400">
                        <Calendar className="w-3 h-3" />
                        {createdDate.toLocaleDateString('en-PK', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      <button
                        onClick={() => setPreviewNote(note)}
                        className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-[11px] sm:text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                        title="Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Preview</span>
                      </button>

                      {deleteTarget === note.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            disabled={deleting}
                            className="px-2 sm:px-2.5 py-2 rounded-xl text-[11px] sm:text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-all disabled:opacity-50"
                          >
                            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Yes'}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(null)}
                            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteTarget(note.id)}
                          className="p-2 sm:px-3 sm:py-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </main>

      {/* Generate Paper Modal */}
      {showPaperModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-accent-blue/10 rounded-xl flex items-center justify-center">
                  <FileQuestion className="w-5 h-5 text-accent-blue" />
                </div>
                <div>
                  <h2 className="font-bold text-navy text-base">Generate Question Paper</h2>
                  <p className="text-xs text-gray-400">Select notes and paper type</p>
                </div>
              </div>
              <button
                onClick={() => setShowPaperModal(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5">
              {/* Subject Selection */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Subject</label>
                <Select
                  value={paperSubject}
                  onChange={(e) => setPaperSubject(e.target.value)}
                  options={subjectOptions}
                  placeholder="Choose a subject..."
                />
              </div>

              {/* Date Range */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Lecture Range</label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setPaperDateMode('all')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${paperDateMode === 'all' ? 'bg-navy text-white' : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-navy/20'}`}
                  >
                    All Lectures
                  </button>
                  <button
                    onClick={() => setPaperDateMode('range')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${paperDateMode === 'range' ? 'bg-navy text-white' : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-navy/20'}`}
                  >
                    Date Range
                  </button>
                </div>
                {paperDateMode === 'range' && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-[11px] text-gray-400 mb-1 block">From</label>
                      <input
                        type="date"
                        value={paperDateFrom}
                        onChange={(e) => setPaperDateFrom(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                      />
                    </div>
                    <span className="text-gray-300 mt-5">—</span>
                    <div className="flex-1">
                      <label className="text-[11px] text-gray-400 mb-1 block">To</label>
                      <input
                        type="date"
                        value={paperDateTo}
                        onChange={(e) => setPaperDateTo(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Paper Type */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Paper Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { key: 'mcq' as const, label: 'MCQ Only', desc: '15 MCQs' },
                    { key: 'short' as const, label: 'Short Q/A', desc: '6 questions' },
                    { key: 'long' as const, label: 'Long Q/A', desc: '4 questions' },
                    { key: 'short-long' as const, label: 'Short + Long', desc: '4+3 mixed' },
                    { key: 'combined' as const, label: 'Combined', desc: 'MCQ+Short+Long' },
                    { key: 'custom' as const, label: 'Custom', desc: 'Set your own' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setPaperType(opt.key)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        paperType === opt.key
                          ? 'border-accent-blue bg-accent-blue/5 ring-1 ring-accent-blue/20'
                          : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                      }`}
                    >
                      <span className="font-semibold text-xs text-navy block">{opt.label}</span>
                      <span className="text-[10px] text-gray-400">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Counts */}
              {paperType === 'custom' && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Question Counts</label>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-400 mb-1 block">MCQs</label>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={mcqCount}
                        onChange={(e) => setMcqCount(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 mb-1 block">Short Q/A</label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={shortCount}
                        onChange={(e) => setShortCount(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 mb-1 block">Long Q/A</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={longCount}
                        onChange={(e) => setLongCount(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Total: {mcqCount * 2 + shortCount * 5 + longCount * 10} marks · ~{Math.ceil((mcqCount * 2 + shortCount * 5 + longCount * 10) * 1.5)} min
                  </p>
                </div>
              )}

              {/* Extra Instructions */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Extra Instructions (Optional)</label>
                <textarea
                  value={extraInstructions}
                  onChange={(e) => setExtraInstructions(e.target.value)}
                  placeholder="e.g., Focus on chapter 3, include diagrams, make it technical..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue resize-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-gray-100 flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400 hidden sm:block">
                {paperType === 'custom' ? `${mcqCount} MCQ + ${shortCount} Short + ${longCount} Long` : `Paper: ${paperType}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPaperModal(false)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGeneratePaper}
                  disabled={paperGenerating || !paperSubject}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-accent-blue hover:bg-accent-blue/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent-blue/10"
                >
                  {paperGenerating ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                  ) : (
                    <><Download className="w-3.5 h-3.5" /> Generate PDF</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Task (manual to-do) Modal */}
      {showTodoModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                  <ListTodo className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h2 className="font-bold text-navy text-base">Assign Task</h2>
                  <p className="text-xs text-gray-400">Create a to-do for your students — anytime</p>
                </div>
              </div>
              <button
                onClick={() => setShowTodoModal(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5">
              {/* Subject Selection */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Subject</label>
                <Select
                  value={todoSubject}
                  onChange={(e) => setTodoSubject(e.target.value)}
                  options={subjectOptions}
                  placeholder="Choose a subject..."
                />
              </div>

              {/* Task Description */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Task Description</label>
                <textarea
                  value={todoTask}
                  onChange={(e) => setTodoTask(e.target.value)}
                  placeholder="e.g., Solve chapter 4 exercises, prepare presentation for Monday..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue resize-none"
                />
                <p className="text-[10px] text-gray-300 mt-1 text-right">{todoTask.length}/500</p>
              </div>

              {/* Task Type */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Task Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'assignment' as const, label: 'Assignment', color: 'bg-blue-600' },
                    { key: 'quiz' as const, label: 'Quiz', color: 'bg-purple-600' },
                    { key: 'reading' as const, label: 'Reading', color: 'bg-amber-500' },
                    { key: 'custom' as const, label: 'Custom', color: 'bg-navy' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setTodoType(opt.key)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold capitalize transition-all ${
                        todoType === opt.key
                          ? `${opt.color} text-white shadow-md`
                          : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Deadline (optional) */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                  Deadline <span className="text-gray-300 normal-case font-medium">(optional)</span>
                </label>
                <input
                  type="date"
                  value={todoDeadline}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setTodoDeadline(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                />
                {todoDeadline && (
                  <button
                    onClick={() => setTodoDeadline('')}
                    className="text-[11px] text-gray-400 hover:text-red-500 mt-1.5 transition-colors"
                  >
                    Remove deadline
                  </button>
                )}
              </div>

              {/* Info note */}
              <div className="bg-accent-blue/5 border border-accent-blue/15 rounded-xl p-3 flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  The task appears instantly in the To-Dos tab of every student enrolled in this subject — no lecture required.
                </p>
              </div>

              {/* Recent tasks — edit or remove tasks already assigned */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <ListTodo className="w-3.5 h-3.5" />
                  Recent tasks
                </p>
                {todoListLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tasks…
                  </div>
                ) : todoList.length === 0 ? (
                  <p className="text-xs text-gray-400">No tasks yet — create your first one above.</p>
                ) : (
                  <div className="space-y-2">
                    {todoList.map(todo => {
                      const meta = TODO_TYPE_META[todo.todo_type] || TODO_TYPE_META.custom
                      const tSubject = subjects.find(s => s.id === todo.subject_id)

                      if (editingTodoId === todo.id) {
                        return (
                          <div key={todo.id} className="rounded-xl border border-accent-blue/25 bg-accent-blue/5 p-3 space-y-2.5">
                            <textarea
                              value={editTask}
                              onChange={e => setEditTask(e.target.value)}
                              rows={2}
                              maxLength={500}
                              placeholder="Task description"
                              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue resize-none"
                            />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(Object.keys(TODO_TYPE_META) as TodoTypeKey[]).map(key => (
                                <button
                                  key={key}
                                  onClick={() => setEditType(key)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${editType === key ? 'bg-navy text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-navy/20'}`}
                                >
                                  {TODO_TYPE_META[key].label}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="date"
                                value={editDeadline}
                                onChange={e => setEditDeadline(e.target.value)}
                                className="px-2.5 py-1.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-accent-blue/20 focus:border-accent-blue"
                              />
                              <div className="flex items-center gap-2 ml-auto">
                                <button
                                  onClick={() => setEditingTodoId(null)}
                                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => void handleUpdateTodo(todo)}
                                  disabled={editSaving || !editTask.trim()}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-accent-blue hover:bg-accent-blue/90 transition-all disabled:opacity-50"
                                >
                                  {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={todo.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 bg-gray-50/50">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide shrink-0 ${meta.pill}`}>
                            {meta.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-600 leading-snug break-words">{todo.task_description}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {tSubject?.subject_name || 'Subject'}{todo.deadline ? ` · due ${todo.deadline}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {deletingTodoId === todo.id ? (
                              <>
                                <button
                                  onClick={() => void handleDeleteTodo(todo.id)}
                                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-all"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setDeletingTodoId(null)}
                                  className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingTodoId(todo.id)
                                    setEditTask(todo.task_description)
                                    setEditType(todo.todo_type)
                                    setEditDeadline(todo.deadline || '')
                                  }}
                                  title="Edit task"
                                  className="p-1.5 rounded-xl text-gray-400 hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeletingTodoId(todo.id)}
                                  title="Delete task"
                                  className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-gray-100 flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400 hidden sm:block capitalize">
                {todoType} · {todoDeadline ? `due ${todoDeadline}` : 'no deadline'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTodoModal(false)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateTodo()}
                  disabled={todoSaving || !todoSubject || !todoTask.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-accent-blue hover:bg-accent-blue/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent-blue/10"
                >
                  {todoSaving ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                  ) : (
                    <><Plus className="w-3.5 h-3.5" /> Create Task</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Note Preview Modal */}
      {previewNote && (() => {
        const nc = previewNote.notes_content
        const sections = nc?.sections_en || nc?.sections || []
        const glossary = nc?.glossary_en || nc?.glossary || []
        const examples = nc?.examples_en || nc?.examples || []
        const quiz = previewNote.quiz_content?.quiz_en || previewNote.quiz_content?.quiz || []
        const noteSubject = subjects.find(s => s.id === previewNote.subject_id)

        return (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94vh] sm:max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-4 sm:p-5 border-b border-gray-100">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-navy text-base">{noteSubject?.subject_name || 'Note Preview'}</h2>
                    {!previewNote.is_published && (
                      <Badge color="yellow">Draft — only you can see this</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">{formatDate(previewNote.lecture_date)}</p>
                </div>
                <button
                  onClick={() => setPreviewNote(null)}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 sm:p-5 space-y-5">
                {/* Summary */}
                {(nc?.summary_en || nc?.summary) && (
                  <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100/50">
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-amber-500" />
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Overview</span>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{nc?.summary_en || nc?.summary}</p>
                  </div>
                )}

                {/* Sections */}
                {sections.map((section, i) => (
                  <div key={i}>
                    <h3 className="font-bold text-navy text-[15px] mb-3">{section.title}</h3>
                    <div className="space-y-2">
                      {section.notes?.map((t, ni) => (
                        <div key={ni} className="flex items-start gap-2.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue mt-2 shrink-0" />
                          <p className="text-sm text-gray-600 leading-relaxed">{t}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Examples */}
                {examples.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-purple-400" />
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Examples</span>
                    </div>
                    <div className="space-y-2">
                      {examples.map((ex, i) => (
                        <div key={i} className="bg-purple-50/40 rounded-xl p-3 border border-purple-100/40">
                          <p className="font-semibold text-navy text-sm">{ex.topic}</p>
                          <p className="text-sm text-gray-600 mt-1">{ex.example}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Glossary */}
                {glossary.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Key Terms</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {glossary.map((item, i) => (
                        <div key={i} className="bg-gray-50 rounded-xl p-2.5 border border-gray-100/50">
                          <span className="font-bold text-navy text-xs block break-words">{item.term}</span>
                          <span className="text-[11px] text-gray-500 leading-relaxed break-words">{item.definition}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tasks created with this lecture — visible with the note */}
                {(() => {
                  const lectureTodos = [
                    ...(nc?.todos || []),
                    ...(previewNote.quiz_content?.todos || []),
                  ]
                  if (lectureTodos.length === 0) return null
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <ListTodo className="w-4 h-4 text-emerald-400" />
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tasks for students ({lectureTodos.length})</span>
                      </div>
                      <div className="space-y-2">
                        {lectureTodos.map((td, i) => (
                          <div key={i} className="bg-emerald-50/40 rounded-xl p-3 border border-emerald-100/40 flex items-center justify-between gap-3 flex-wrap">
                            <p className="text-sm text-gray-600 break-words min-w-0">{td.task}</p>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 shrink-0">
                              {td.type}{td.deadline ? ` · due ${td.deadline}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2">Students see these in their To-Dos tab — you can edit or remove them anytime from Assign Task.</p>
                    </div>
                  )
                })()}

                {/* Quiz */}
                {quiz.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FileQuestion className="w-4 h-4 text-blue-400" />
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Quiz ({quiz.length} questions)</span>
                    </div>
                    <div className="space-y-3">
                      {quiz.map((q, qi) => (
                        <div key={qi} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                          <p className="font-semibold text-navy text-sm mb-2">Q{qi + 1}. {q.question}</p>
                          {q.options?.map((opt, oi) => (
                            <p key={oi} className={`text-xs py-0.5 ${oi === q.correctIndex ? 'text-emerald-600 font-semibold' : 'text-gray-500'}`}>
                              {String.fromCharCode(65 + oi)}) {opt} {oi === q.correctIndex ? '✓' : ''}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Draft footer — review first, publish when ready */}
              {!previewNote.is_published && (
                <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-100 p-4 sm:px-5 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[11px] text-gray-400 hidden sm:block">
                    Students can't see this note until you publish it.
                  </p>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      onClick={() => setPreviewNote(null)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                    >
                      Keep as draft
                    </button>
                    <button
                      onClick={() => void handlePublishNote()}
                      disabled={publishingNote}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-all disabled:opacity-50 shadow-md shadow-emerald-500/20"
                    >
                      {publishingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Publish to Students
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function StatCard({ label, value, gradient, icon, accent }: {
  label: string; value: string | number; gradient: string; icon: React.ReactNode; accent?: string
}) {
  return (
    <div className={clsx('admin-stat-card', accent)}>
      <div className="flex items-center gap-3">
        <div className={clsx('w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-white shadow-md bg-gradient-to-br', gradient)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xl sm:text-2xl font-extrabold text-navy tabular-nums leading-none">{value}</p>
          <p className="text-[11px] sm:text-xs text-gray-500 font-medium mt-1 truncate">{label}</p>
        </div>
      </div>
    </div>
  )
}
