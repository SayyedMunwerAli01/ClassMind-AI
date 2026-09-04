-- Reading Progress & Streak Tracking
-- Tracks which notes a student has viewed, per unique day (no duplicate days)

CREATE TABLE IF NOT EXISTS public.reading_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    note_id UUID NOT NULL REFERENCES public.daily_notes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    read_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, note_id, read_date)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_student ON public.reading_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_date ON public.reading_progress(read_date);
