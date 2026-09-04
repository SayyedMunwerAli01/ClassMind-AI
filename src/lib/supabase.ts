import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants'
import type {
  UserProfile, Subject, StudentEnrollment, TeacherTimetable, DailyNote,
  GlobalTodo, NotesContent, QuizContent, ActiveSession,
} from './types'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Helper: Fetch user profile
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()
  
  if (error) return null
  return data as UserProfile
}

// Helper: Fetch all subjects
export async function fetchAllSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .order('subject_name')
  
  if (error) return []
  return data as Subject[]
}

// Helper: Fetch student enrollments
export async function fetchStudentEnrollments(studentId: string): Promise<StudentEnrollment[]> {
  const { data, error } = await supabase
    .from('student_enrollments')
    .select('*')
    .eq('student_id', studentId)
  
  if (error) return []
  return data as StudentEnrollment[]
}

// Helper: Fetch teacher timetable
export async function fetchTeacherTimetable(teacherId: string): Promise<TeacherTimetable[]> {
  const { data, error } = await supabase
    .from('master_timetable')
    .select('*')
    .eq('teacher_id', teacherId)

  if (error) return []
  return data as TeacherTimetable[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Timetable scheduling (admin)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllTimetable(): Promise<TeacherTimetable[]> {
  const { data, error } = await supabase
    .from('master_timetable')
    .select('*')

  if (error) return []
  return (data || []) as TeacherTimetable[]
}

export async function createTimetableSlot(
  teacherId: string,
  subjectId: string,
  day: string,
  startTime: string,
  endTime: string,
): Promise<TeacherTimetable | null> {
  const { data, error } = await supabase
    .from('master_timetable')
    .insert({
      teacher_id: teacherId,
      subject_id: subjectId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as TeacherTimetable
}

export async function updateTimetableSlot(
  slotId: string,
  patch: { teacher_id?: string; subject_id?: string; day_of_week?: string; start_time?: string; end_time?: string },
): Promise<boolean> {
  const { error } = await supabase
    .from('master_timetable')
    .update(patch)
    .eq('id', slotId)

  if (error) throw new Error(error.message)
  return true
}

export async function deleteTimetableSlot(slotId: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_timetable')
    .delete()
    .eq('id', slotId)

  if (error) throw new Error(error.message)
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Live classroom part-locks
// ─────────────────────────────────────────────────────────────────────────────

/** All currently live sessions (drives part-locks + admin live monitor). */
export async function fetchActiveSessions(): Promise<ActiveSession[]> {
  const { data, error } = await supabase
    .from('active_sessions')
    .select('*')
    .eq('is_active', true)

  if (error) return []
  return (data || []) as ActiveSession[]
}

/**
 * Acquire the part-lock and register a live class.
 * Closes the teacher's own previous (stale) sessions first, then inserts a
 * fresh live row. Fails when another teacher is live in the same part.
 */
export async function startLiveSession(
  teacherId: string,
  subjectId: string,
  sessionId: string,
): Promise<{ row: ActiveSession | null; error: string | null }> {
  // Release any of my own leftover live rows first (crash recovery)
  await supabase
    .from('active_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('teacher_id', teacherId)
    .eq('is_active', true)

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('active_sessions')
    .insert({
      teacher_id: teacherId,
      subject_id: subjectId,
      session_id: sessionId,
      is_active: true,
      last_ping: now,
    })
    .select()
    .single()

  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (error.code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
      return { row: null, error: 'Another class is already live in this part. The mic unlocks when it ends.' }
    }
    if (error.code === '42501' || msg.includes('row-level security')) {
      return { row: null, error: 'Your part is currently locked by another live class.' }
    }
    return { row: null, error: error.message }
  }

  return { row: (data || null) as ActiveSession | null, error: null }
}

/** Heartbeat — keeps the lock alive while recording. */
export async function pingLiveSession(rowId: string): Promise<void> {
  await supabase
    .from('active_sessions')
    .update({ last_ping: new Date().toISOString() })
    .eq('id', rowId)
}

/** End a live session by its lock row id (owner or admin). */
export async function endLiveSession(rowId: string): Promise<boolean> {
  const { error } = await supabase
    .from('active_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('id', rowId)

  return !error
}

/** End a live session by recorder session id. */
export async function endLiveSessionBySessionId(sessionId: string): Promise<void> {
  await supabase
    .from('active_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('is_active', true)
}

/**
 * Force-end a live session (admin always; same-part teachers only when the
 * session has gone stale — no heartbeat for 2+ minutes).
 */
export async function forceEndLiveSession(rowId: string, endedByName: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('active_sessions')
    .update({
      is_active: false,
      ended_at: new Date().toISOString(),
      kicked_by: endedByName,
    })
    .eq('id', rowId)
    .select()

  // RLS silently drops rows the caller isn't allowed to end (e.g. the session
  // is no longer stale) — treat a zero-row update as a failure.
  return !error && (data?.length ?? 0) > 0
}

// Helper: Fetch published notes for a subject (what students see)
export async function fetchPublishedNotes(subjectId: string): Promise<DailyNote[]> {
  const { data, error } = await supabase
    .from('daily_notes')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('is_published', true)
    .order('lecture_date', { ascending: false })
  
  if (error) return []
  return data as DailyNote[]
}

/**
 * All notes for a subject — drafts included. Only the owning teacher can
 * see drafts (RLS); students only ever receive published notes.
 */
export async function fetchTeacherNotes(subjectId: string): Promise<DailyNote[]> {
  const { data, error } = await supabase
    .from('daily_notes')
    .select('*')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })

  if (error) return []
  return data as DailyNote[]
}

// Helper: Fetch todos for a subject
export async function fetchSubjectTodos(subjectId: string): Promise<GlobalTodo[]> {
  const { data, error } = await supabase
    .from('global_todos')
    .select('*')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
  
  if (error) return []
  return data as GlobalTodo[]
}

// Helper: Fetch all profiles (admin use)
export async function fetchAllProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) return []
  return data as UserProfile[]
}

// Helper: Update the signed-in user's own profile. `role` only works during
// the 10-minute sign-up completion window (see migration 005) — role,
// approval and suspension are otherwise protected by a database trigger.
export async function updateProfile(
  userId: string,
  patch: { full_name?: string; avatar_url?: string | null; role?: 'student' | 'teacher' },
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase
    .from('user_profiles')
    .update(patch)
    .eq('id', userId)

  return error ? { ok: false, error: error.message } : { ok: true, error: null }
}

/** Upload a profile picture to the public `avatars` bucket. */
export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${userId}/avatar-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (error) return { url: null, error: error.message }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

/** Continue with Google — redirects to Google and back to the app. */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  return { error: error?.message || null }
}

// Helper: Update profile approval status
export async function updateProfileApproval(userId: string, isApproved: boolean, isSuspended: boolean = false) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ is_approved: isApproved, is_suspended: isSuspended })
    .eq('id', userId)
  
  return !error
}

// Helper: Create subject
export async function createSubject(name: string, code: string, part: string) {
  const { data, error } = await supabase
    .from('subjects')
    .insert({ subject_name: name, subject_code: code, part })
    .select()
    .single()
  
  return data as Subject | null
}

// Helper: Enroll student in subject
export async function enrollStudent(studentId: string, subjectId: string) {
  const { error } = await supabase
    .from('student_enrollments')
    .insert({ student_id: studentId, subject_id: subjectId })
  
  return !error
}

// Helper: Assign teacher to subject
export async function assignTeacher(teacherId: string, subjectId: string) {
  const { error } = await supabase
    .from('master_timetable')
    .insert({ teacher_id: teacherId, subject_id: subjectId })
  
  return !error
}

// Helper: Unassign (remove) teacher from a subject
export async function unassignTeacher(teacherId: string, subjectId: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_timetable')
    .delete()
    .eq('teacher_id', teacherId)
    .eq('subject_id', subjectId)

  return !error
}

// Helper: Create todo
export async function createTodo(subjectId: string, taskDescription: string, todoType: string, deadline?: string, createdBy?: string) {
  const { error } = await supabase
    .from('global_todos')
    .insert({ 
      subject_id: subjectId, 
      task_description: taskDescription, 
      todo_type: todoType, 
      deadline: deadline || null,
      created_by: createdBy || null
    })
  
  return !error
}

// Helper: Update todo completion
export async function updateTodoCompletion(todoId: string, isCompleted: boolean) {
  const { error } = await supabase
    .from('global_todos')
    .update({ is_completed: isCompleted })
    .eq('id', todoId)
  
  return !error
}

/** Teacher edits a task they already assigned (text, type, deadline). */
export async function updateTodoDetails(
  todoId: string,
  patch: { task_description?: string; todo_type?: string; deadline?: string | null },
) {
  const { error } = await supabase
    .from('global_todos')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', todoId)

  return !error
}

/** Teacher deletes a task they already assigned. */
export async function deleteTodo(todoId: string) {
  const { error } = await supabase
    .from('global_todos')
    .delete()
    .eq('id', todoId)

  return !error
}

// Helper: Create note record. Pass isPublished=false to save a DRAFT the
// teacher reviews before students can see it.
export async function createNoteRecord(
  subjectId: string,
  teacherId: string,
  lectureDate: string,
  notesContent: NotesContent,
  quizContent: QuizContent,
  isPublished = true,
) {
  const { data, error } = await supabase
    .from('daily_notes')
    .insert({
      subject_id: subjectId,
      teacher_id: teacherId,
      lecture_date: lectureDate,
      notes_content: notesContent,
      quiz_content: quizContent,
      is_published: isPublished,
    })
    .select()
    .single()
  
  return data as DailyNote | null
}

// Helper: Publish note
export async function publishNote(noteId: string) {
  const { error } = await supabase
    .from('daily_notes')
    .update({ is_published: true })
    .eq('id', noteId)
  
  return !error
}

// Helper: Delete note
export async function deleteNote(noteId: string) {
  const { error } = await supabase
    .from('daily_notes')
    .delete()
    .eq('id', noteId)
  
  return !error
}

// Helper: Track reading progress (upsert - won't duplicate same day)
export async function trackReadingProgress(studentId: string, noteId: string, subjectId: string) {
  const today = new Date().toISOString().split('T')[0]
  await supabase
    .from('reading_progress')
    .upsert(
      { student_id: studentId, note_id: noteId, subject_id: subjectId, read_date: today },
      { onConflict: 'student_id,note_id,read_date' }
    )
}

// Helper: Get student streak (unique days with reading activity)
export async function getStudentStreak(studentId: string): Promise<number> {
  const { data } = await supabase
    .from('reading_progress')
    .select('read_date')
    .eq('student_id', studentId)
    .order('read_date', { ascending: false })

  if (!data || data.length === 0) return 0

  const uniqueDates = [...new Set(data.map(d => d.read_date))].sort().reverse()
  let streak = 1
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) return 0

  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1])
    const curr = new Date(uniqueDates[i])
    const diff = (prev.getTime() - curr.getTime()) / 86400000
    if (diff === 1) {
      streak++
    } else {
      break
    }
  }
  return streak
}

// Helper: Get total unique notes read by student
export async function getNotesReadCount(studentId: string): Promise<number> {
  const { data } = await supabase
    .from('reading_progress')
    .select('note_id')
    .eq('student_id', studentId)

  if (!data) return 0
  return new Set(data.map(d => d.note_id)).size
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Subject CRUD
// ─────────────────────────────────────────────────────────────────────────────

/** Update a subject's name, code, or part. Returns updated subject or null. */
export async function updateSubject(
  subjectId: string,
  patch: { subject_name?: string; subject_code?: string; part?: string },
): Promise<Subject | null> {
  const { data, error } = await supabase.rpc('admin_update_subject', {
    p_subject_id: subjectId,
    p_name: patch.subject_name ?? null,
    p_code: patch.subject_code ?? null,
    p_part: patch.part ?? null,
  })
  if (error) return null
  return data as Subject | null
}

/** Delete a subject and all related data (enrollments, timetable, notes, todos). */
export async function deleteSubject(subjectId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_delete_subject', {
    p_subject_id: subjectId,
  })
  if (error) return false
  return data === true
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Enrollment management
// ─────────────────────────────────────────────────────────────────────────────

/** Enroll a student in multiple subjects at once. Returns count of new enrollments. */
export async function bulkEnrollStudent(studentId: string, subjectIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('admin_bulk_enroll', {
    p_student_id: studentId,
    p_subject_ids: subjectIds,
  })
  if (error) return 0
  return data as number
}

/** Remove a student from a specific subject. */
export async function unenrollStudent(studentId: string, subjectId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_unenroll', {
    p_student_id: studentId,
    p_subject_id: subjectId,
  })
  if (error) return false
  return data === true
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: User management
// ─────────────────────────────────────────────────────────────────────────────

/** Assign a part/year to a student. */
export async function setStudentPart(userId: string, part: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_set_student_part', {
    p_user_id: userId,
    p_part: part,
  })
  if (error) return false
  return data === true
}

/** Delete a user entirely (cascades via FK). */
export async function deleteUser(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_delete_user', {
    p_user_id: userId,
  })
  if (error) return false
  return data === true
}

/** Change a user's role (student <-> teacher). */
export async function changeUserRole(userId: string, newRole: 'student' | 'teacher' | 'admin'): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_change_role', {
    p_user_id: userId,
    p_new_role: newRole,
  })
  if (error) return false
  return data === true
}