import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStudentGuard } from '@/hooks/useStudentGuard'
import {
  fetchStudentEnrollments, fetchAllSubjects,
  fetchPublishedNotes, fetchSubjectTodos,
  supabase, getStudentStreak, getNotesReadCount,
} from '@/lib/supabase'
import { getGreeting, formatDate, getColorForIndex } from '@/lib/helpers'
import { COLOR_PALETTE } from '@/lib/constants'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import AppHeader from '@/components/AppHeader'
import type { Subject, DailyNote } from '@/lib/types'
import {
  BookOpen, FileText, Search,
  Calendar, ChevronRight, ListTodo, User,
  Flame, TrendingUp, Eye,
} from 'lucide-react'

interface EnrolledSubject extends Subject {
  noteCount: number
  colorIndex: number
}

export default function StudentDashboard() {
  const { verified, user, profile } = useStudentGuard()
  const [subjects, setSubjects] = useState<EnrolledSubject[]>([])
  const [recentNotes, setRecentNotes] = useState<DailyNote[]>([])
  const [todoCount, setTodoCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({})
  const [streak, setStreak] = useState(0)
  const [notesRead, setNotesRead] = useState(0)

  useEffect(() => {
    if (!verified || !user) return

    const loadDashboard = async () => {
      setLoading(true)
      try {
        const [enrollments, allSubjects] = await Promise.all([
          fetchStudentEnrollments(user.id),
          fetchAllSubjects(),
        ])

        const enrolledSubjects = allSubjects.filter(s =>
          enrollments.some(e => e.subject_id === s.id)
        )

        const subjectsWithNotes = await Promise.all(
          enrolledSubjects.map(async (subject, index) => {
            const notes = await fetchPublishedNotes(subject.id)
            return { ...subject, noteCount: notes.length, colorIndex: index }
          })
        )

        setSubjects(subjectsWithNotes)

        // Recent notes
        const allNotesArrays = await Promise.all(
          subjectsWithNotes.map(s => fetchPublishedNotes(s.id))
        )
        const allNotes = allNotesArrays.flat()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 5)
        setRecentNotes(allNotes)

        // Todo count
        const todosArrays = await Promise.all(
          subjectsWithNotes.map(s => fetchSubjectTodos(s.id))
        )
        setTodoCount(todosArrays.flat().filter(t => !t.is_completed).length)

        // Teacher names
        const teacherIds = [...new Set(allNotes.map(n => n.teacher_id).filter(Boolean))]
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

        // Reading stats
        const [streakData, notesReadData] = await Promise.all([
          getStudentStreak(user.id),
          getNotesReadCount(user.id),
        ])
        setStreak(streakData)
        setNotesRead(notesReadData)
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [verified, user])

  const filteredSubjects = subjects.filter(s =>
    s.subject_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.subject_code.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalNotes = subjects.reduce((acc, s) => acc + s.noteCount, 0)

  if (!verified) return null

  return (
    <div className="min-h-screen bg-accent-light">
      {/* Header */}
      <AppHeader portalName="Student Portal" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero Banner */}
        <div className="hero-banner mb-8 animate-fade-up">
          <div className="relative z-10">
            <p className="text-white/50 text-sm mb-1">{formatDate(new Date().toISOString())}</p>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">
              {getGreeting()}, <span className="text-accent-blue">{profile?.full_name?.split(' ')[0]}</span>!
            </h1>
            <p className="text-white/60 text-sm">Ready to study? Here's your academic overview.</p>
          </div>
        </div>

        {/* Reading Progress & Streak */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent-blue" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Your Progress</span>
            </div>
            <span className="text-[11px] text-gray-400">
              {notesRead}/{totalNotes} notes
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-gradient-to-r from-accent-blue to-accent-purple rounded-full transition-all duration-700"
              style={{ width: totalNotes > 0 ? `${Math.min(100, (notesRead / totalNotes) * 100)}%` : '0%' }}
            />
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <Flame className={`w-5 h-5 mx-auto mb-1 ${streak > 0 ? 'text-orange-500' : 'text-gray-300'}`} />
              <p className="text-lg font-bold text-navy">{streak}</p>
              <p className="text-[10px] text-gray-400 font-medium">Day Streak</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <Eye className="w-5 h-5 text-blue-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-navy">{notesRead}</p>
              <p className="text-[10px] text-gray-400 font-medium">Notes Read</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <TrendingUp className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-navy">
                {totalNotes > 0 ? Math.round((notesRead / totalNotes) * 100) : 0}%
              </p>
              <p className="text-[10px] text-gray-400 font-medium">Completed</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <ListTodo className="w-5 h-5 text-amber-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-navy">{todoCount}</p>
              <p className="text-[10px] text-gray-400 font-medium">Pending</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search subjects..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white shadow-sm border border-gray-100 focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/10 focus:outline-none transition-all"
          />
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} variant="card" className="h-44" />
            ))}
          </div>
        ) : (
          <>
            {/* Subjects Grid */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-navy">Your Subjects</h2>
              <span className="text-xs text-gray-400 font-medium">{filteredSubjects.length} enrolled</span>
            </div>
            {filteredSubjects.length === 0 ? (
              <div className="empty-state">
                <BookOpen className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                <h3 className="text-base font-semibold text-gray-500">No subjects found</h3>
                <p className="text-sm text-gray-400 mt-1">Contact your administrator to get enrolled.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
                {filteredSubjects.map((subject) => (
                  <Link
                    key={subject.id}
                    to={`/student/subject/${subject.id}`}
                    className="card group hover:-translate-y-1 transition-all duration-300"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-md"
                        style={{ backgroundColor: getColorForIndex(subject.colorIndex, COLOR_PALETTE) }}
                      >
                        {subject.subject_name[0]}
                      </div>
                      <Badge color="blue">{subject.subject_code}</Badge>
                    </div>
                    <h3 className="font-bold text-navy text-base mb-1">{subject.subject_name}</h3>
                    <p className="text-xs text-gray-400 mb-4">Part: {subject.part}</p>
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <span className="text-xs text-gray-400 font-medium">{subject.noteCount} notes</span>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-accent-blue group-hover:translate-x-1 transition-all" />
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Recent Notes */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-navy">Recent Notes</h2>
              {recentNotes.length > 0 && (
                <span className="text-xs text-gray-400 font-medium">{recentNotes.length} latest</span>
              )}
            </div>
            <div className="space-y-4">
              {recentNotes.length === 0 ? (
                <div className="empty-state">
                  <FileText className="w-14 h-14 text-gray-200 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-gray-500">No notes published yet</h3>
                  <p className="text-sm text-gray-400 mt-1">Check back soon — your teachers are preparing notes.</p>
                </div>
              ) : (
                recentNotes.map((note) => {
                  const subject = subjects.find(s => s.id === note.subject_id)
                  const nc = note.notes_content
                  const qc = note.quiz_content
                  const quizCount = (qc?.quiz_en || qc?.quiz || []).length
                  const createdDate = new Date(note.created_at)
                  const teacherName = teacherNames[note.teacher_id] || ''
                  return (
                    <Link
                      key={note.id}
                      to={`/student/note/${note.id}`}
                      className="card flex items-center gap-4 group hover:-translate-y-0.5 transition-all"
                    >
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                        style={{ backgroundColor: getColorForIndex(subject?.colorIndex || 0, COLOR_PALETTE) }}
                      >
                        <FileText className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {subject?.subject_name || 'Subject'}
                          </span>
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
                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-accent-blue group-hover:translate-x-1 transition-all shrink-0" />
                    </Link>
                  )
                })
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
