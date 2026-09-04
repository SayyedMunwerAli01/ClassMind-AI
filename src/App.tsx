import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, Suspense, lazy } from 'react'
import { useAuth } from './hooks/useAuth'
import { useInactivityLogout } from './hooks/useInactivityLogout'
import { updateProfile } from './lib/supabase'
import { Logo } from './components/Logo'

// Lazy-loaded pages for code-splitting (faster initial load)
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const PendingApproval = lazy(() => import('./pages/PendingApproval'))
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'))
const SubjectHome = lazy(() => import('./pages/student/SubjectHome'))
const NoteViewer = lazy(() => import('./pages/student/NoteViewer'))
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  const { user, profile, loading, refreshProfile } = useAuth()
  useInactivityLogout() // auto-logout after 15 min idle

  // Complete Google sign-ups: apply the role chosen before the OAuth redirect
  // (student/teacher only — the DB blocks anything else outside the window).
  useEffect(() => {
    if (loading || !user || !profile) return
    const pendingRole = localStorage.getItem('classmind_pending_role')
    if (!pendingRole) return
    localStorage.removeItem('classmind_pending_role')
    if ((pendingRole === 'teacher' || pendingRole === 'student')
      && profile.role === 'student' && !profile.is_approved) {
      void updateProfile(user.id, { role: pendingRole }).then(() => refreshProfile())
    }
  }, [loading, user, profile, refreshProfile])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy via-navy-dark to-navy">
        <div className="text-center animate-fade-in">
          <div className="mx-auto mb-6 animate-pulse-soft">
            <Logo size={80} glow />
          </div>
          <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/70 font-medium text-sm tracking-wide">Loading ClassMind AI</p>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={user ? <Navigate to={getDashboardPath(profile?.role)} /> : <Landing />} />
        <Route path="/login" element={user ? <Navigate to={getDashboardPath(profile?.role)} /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to={getDashboardPath(profile?.role)} /> : <Register />} />
        <Route path="/pending" element={user && profile && !profile.is_approved ? <PendingApproval /> : <Navigate to="/" />} />
        <Route path="/student/dashboard" element={<StudentDashboard />} />
        <Route path="/student/subject/:subjectId" element={<SubjectHome />} />
        <Route path="/student/note/:noteId" element={<NoteViewer />} />
        <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

function getDashboardPath(role?: string): string {
  switch (role) {
    case 'admin': return '/admin/dashboard'
    case 'teacher': return '/teacher/dashboard'
    case 'student': return '/student/dashboard'
    default: return '/'
  }
}

/** Spinner shown while lazy-loaded page chunks download. */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-accent-light">
      <div className="text-center animate-fade-in">
        <div className="mx-auto mb-4 animate-pulse-soft">
          <Logo size={48} glow />
        </div>
        <div className="w-6 h-6 border-2 border-navy/20 border-t-navy rounded-full animate-spin mx-auto" />
      </div>
    </div>
  )
}
