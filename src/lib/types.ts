export type UserRole = 'admin' | 'teacher' | 'student'

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  avatar_url?: string | null
  is_approved: boolean
  is_suspended: boolean
  student_part?: string | null
  created_at: string
}

export interface Subject {
  id: string
  subject_name: string
  subject_code: string
  part: string
  created_at: string
}

export interface StudentEnrollment {
  id: string
  student_id: string
  subject_id: string
  enrolled_at: string
}

export interface TeacherTimetable {
  id: string
  teacher_id: string
  subject_id: string
  day_of_week?: string | null
  start_time?: string | null
  end_time?: string | null
  assigned_at: string
}

/** A live classroom lock — only one active session per part at a time. */
export interface ActiveSession {
  id: string
  session_id: string
  teacher_id: string
  subject_id: string
  part?: string | null
  is_active: boolean
  last_ping?: string | null
  ended_at?: string | null
  kicked_by?: string | null
  started_at: string
}

export interface NotesContent {
  summary: string
  summary_en: string
  sections: { title: string; notes: string[] }[]
  sections_en: { title: string; notes: string[] }[]
  notes: string[]
  notes_en: string[]
  examples?: { topic: string; example: string; context?: string }[]
  examples_en?: { topic: string; example: string; context?: string }[]
  glossary: { term: string; definition: string }[]
  glossary_en: { term: string; definition: string }[]
  todos: { task: string; deadline?: string; type: string }[]
  mindmap: {
    central: string
    branches: { topic: string; subtopics: string[] }[]
  }
}

export interface QuizContent {
  quiz: {
    question: string
    options: string[]
    correctIndex: number
    explanation: string
  }[]
  quiz_en: {
    question: string
    options: string[]
    correctIndex: number
    explanation: string
  }[]
  shortQA: { question: string; answer: string }[]
  shortQA_en: { question: string; answer: string }[]
  todos?: { task: string; deadline?: string; type: string }[]
}

export interface DailyNote {
  id: string
  subject_id: string
  teacher_id: string
  lecture_date: string
  notes_content: NotesContent
  quiz_content: QuizContent
  is_published: boolean
  created_at: string
}

export interface GlobalTodo {
  id: string
  subject_id: string
  todo_type: 'assignment' | 'quiz' | 'reading' | 'custom'
  task_description: string
  deadline?: string
  is_completed: boolean
  created_by: string
  created_at: string
}