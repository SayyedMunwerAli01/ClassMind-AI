-- ClassMind AI Database Schema

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')) DEFAULT 'student',
    is_approved BOOLEAN NOT NULL DEFAULT false,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create subjects table
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_name TEXT NOT NULL,
    subject_code TEXT NOT NULL,
    part TEXT NOT NULL DEFAULT '1st Year',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create student_enrollments junction table
CREATE TABLE IF NOT EXISTS public.student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, subject_id)
);

-- Create master_timetable junction table
CREATE TABLE IF NOT EXISTS public.master_timetable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(teacher_id, subject_id)
);

-- Create daily_notes table
CREATE TABLE IF NOT EXISTS public.daily_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    lecture_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    quiz_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create global_todos table
CREATE TABLE IF NOT EXISTS public.global_todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    todo_type TEXT NOT NULL CHECK (todo_type IN ('assignment', 'quiz', 'reading', 'custom')) DEFAULT 'custom',
    task_description TEXT NOT NULL,
    deadline DATE,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create session_transcripts table
CREATE TABLE IF NOT EXISTS public.session_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    teacher_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
    accumulated_text TEXT NOT NULL DEFAULT '',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create active_sessions table
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    teacher_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_approval ON public.user_profiles(is_approved);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_subject ON public.student_enrollments(subject_id);
CREATE INDEX IF NOT EXISTS idx_master_timetable_teacher ON public.master_timetable(teacher_id);
CREATE INDEX IF NOT EXISTS idx_master_timetable_subject ON public.master_timetable(subject_id);
CREATE INDEX IF NOT EXISTS idx_daily_notes_subject ON public.daily_notes(subject_id);
CREATE INDEX IF NOT EXISTS idx_daily_notes_published ON public.daily_notes(is_published);
CREATE INDEX IF NOT EXISTS idx_global_todos_subject ON public.global_todos(subject_id);
CREATE INDEX IF NOT EXISTS idx_session_transcripts_session ON public.session_transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_session ON public.active_sessions(session_id);

-- Create helper function: Check if student is enrolled in a subject
CREATE OR REPLACE FUNCTION public.is_enrolled(student_uuid UUID, subject_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.student_enrollments 
        WHERE student_id = student_uuid AND subject_id = subject_uuid
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create helper function: Check if teacher is assigned to a subject
CREATE OR REPLACE FUNCTION public.is_assigned_teacher(teacher_uuid UUID, subject_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.master_timetable 
        WHERE teacher_id = teacher_uuid AND subject_id = subject_uuid
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;