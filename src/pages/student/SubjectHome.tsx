import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStudentGuard } from '@/hooks/useStudentGuard'
import { fetchPublishedNotes, fetchSubjectTodos, fetchAllSubjects, supabase } from '@/lib/supabase'
import { formatDate, getColorForIndex } from '@/lib/helpers'
import { COLOR_PALETTE } from '@/lib/constants'
import { Skeleton } from '@/components/ui/Skeleton'
import AppHeader from '@/components/AppHeader'
import type { Subject, DailyNote, GlobalTodo } from '@/lib/types'
import {
  ArrowLeft, FileText, CheckSquare, ListTodo,
  ChevronRight, Calendar, Clock, User,
} from 'lucide-react'
import { clsx } from 'clsx'

export default function SubjectHome() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { verified } = useStudentGuard()
  const [subject, setSubject] = useState<Subject | null>(null)
  const [notes, setNotes] = useState<DailyNote[]>([])
  const [todos, setTodos] = useState<GlobalTodo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'notes' | 'todos'>('notes')
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!verified || !subjectId) return

    const loadSubject = async () => {
      setLoading(true)
      try {
        const [subjects, notesData, todosData] = await Promise.all([
          fetchAllSubjects(),
          fetchPublishedNotes(subjectId),
          fetchSubjectTodos(subjectId),
        ])

        setSubject(subjects.find(s => s.id === subjectId) || null)
        setNotes(notesData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
        setTodos(todosData)

        // Fetch teacher names
        const teacherIds = [...new Set(notesData.map(n => n.teacher_id).filter(Boolean))]
        if (teacherIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, full_name')
            .in('id', teacherIds)
          if (profiles) {
            const nameMap: Record<string, string> = {}
            profiles.forEach(p => { nameMap[p.id] = p.full_name })
            setTeacherNames(nameMap)
          }
        }
      } catch (err) {
        console.error('Subject load error:', err)
      } finally {
        setLoading(false)
      }
    }

    loadSubject()
  }, [verified, subjectId])

  if (!verified) return null
  if (!subjectId) return null

  const pendingTodos = todos.filter(t => !t.is_completed)

  return (
    <div className="min-h-screen bg-accent-light">
      {/* Main app header (consistent with every other page) */}
      <AppHeader portalName="Student Portal" sticky={false} />

      {/* Subject sub-header — soft band, distinct from the navy header above */}
      <div className="sub-header px-4 sm:px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <Link to="/student/dashboard" className="inline-flex items-center gap-2 text-accent-blue hover:text-navy mb-3 transition-colors text-sm font-semibold">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          {loading ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-navy to-navy-light rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-navy/25">
                {subject?.subject_name?.[0] || '?'}
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-navy truncate">{subject?.subject_name}</h1>
                <p className="text-sm text-navy/50 font-medium">
                  {subject?.subject_code} &middot; Part {subject?.part}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('notes')}
            className={clsx('tab-btn', activeTab === 'notes' ? 'tab-btn-active' : 'tab-btn-inactive')}
          >
            <FileText className="w-4 h-4" />
            Notes ({notes.length})
          </button>
          <button
            onClick={() => setActiveTab('todos')}
            className={clsx('tab-btn', activeTab === 'todos' ? 'tab-btn-active' : 'tab-btn-inactive')}
          >
            <ListTodo className="w-4 h-4" />
            To-Dos ({pendingTodos.length})
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} variant="rect" className="h-20" />
            ))}
          </div>
        ) : activeTab === 'notes' ? (
          notes.length === 0 ? (
            <div className="empty-state">
              <FileText className="w-16 h-16 text-gray-200 mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-500">No notes published yet</h3>
              <p className="text-sm text-gray-400 mt-1">Notes will appear here once your teacher publishes them.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {notes.map((note, index) => {
                const nc = note.notes_content
                const qc = note.quiz_content
                const quizCount = (qc?.quiz_en || qc?.quiz || []).length
                const createdDate = new Date(note.created_at)
                const isNew = (Date.now() - createdDate.getTime()) < 3 * 24 * 60 * 60 * 1000 // 3 days
                const teacherName = teacherNames[note.teacher_id] || ''

                return (
                  <Link
                    key={note.id}
                    to={`/student/note/${note.id}`}
                    className="block rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden group"
                  >
                    <div className="px-5 py-4 flex items-center gap-4">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                        style={{ backgroundColor: getColorForIndex(index, COLOR_PALETTE) }}
                      >
                        <FileText className="w-5 h-5 text-white" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {subject?.subject_name || 'Subject'}
                          </span>
                          {isNew && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-600 uppercase">
                              New
                            </span>
                          )}
                          {quizCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-50 text-purple-600 uppercase">
                              Quiz
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <Calendar className="w-3 h-3" />
                            {createdDate.toLocaleDateString('en-PK', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          {teacherName && (
                            <span className="inline-flex items-center gap-1 shrink-0">
                              <User className="w-3 h-3" />
                              {teacherName}
                            </span>
                          )}
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-navy text-white text-xs font-bold shrink-0 group-hover:bg-accent-blue transition-colors duration-200">
                        Open
                        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        ) : (
          todos.length === 0 ? (
            <div className="empty-state">
              <ListTodo className="w-16 h-16 text-gray-200 mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-500">No to-do items</h3>
              <p className="text-sm text-gray-400 mt-1">Your teacher hasn't assigned any tasks yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {todos.map((todo) => {
                const isOverdue = todo.deadline && !todo.is_completed && new Date(todo.deadline) < new Date()
                return (
                  <div key={todo.id} className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
                    {/* Top Row: Type Pill + Status */}
                    <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                      <div className={clsx(
                        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase',
                        todo.todo_type === 'assignment' && 'bg-blue-50 text-blue-600',
                        todo.todo_type === 'quiz' && 'bg-purple-50 text-purple-600',
                        todo.todo_type === 'reading' && 'bg-amber-50 text-amber-600',
                        todo.todo_type === 'custom' && 'bg-gray-50 text-gray-500',
                      )}>
                        <ListTodo className="w-3 h-3" />
                        {todo.todo_type}
                      </div>
                      {todo.is_completed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 uppercase tracking-wider">
                          <CheckSquare className="w-3 h-3" />
                          Done
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-500 uppercase tracking-wider">
                          <Clock className="w-3 h-3" />
                          Overdue
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-500 uppercase tracking-wider">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </div>

                    {/* Task Description */}
                    <div className="px-5 pb-3">
                      <p className={clsx(
                        'font-bold text-[15px] leading-snug',
                        todo.is_completed ? 'line-through text-gray-300' : 'text-navy',
                      )}>
                        {todo.task_description}
                      </p>
                    </div>

                    {/* Deadline + Date Row */}
                    <div className="px-5 pb-4 flex items-center justify-between">
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        {todo.deadline && (
                          <span className={clsx(
                            'inline-flex items-center gap-1.5',
                            isOverdue && 'text-red-400 font-semibold',
                          )}>
                            <Calendar className="w-3.5 h-3.5" />
                            Due: {formatDate(todo.deadline)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5 text-gray-300">
                          <Clock className="w-3 h-3" />
                          {new Date(todo.created_at).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
