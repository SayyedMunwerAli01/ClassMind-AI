-- ═══════════════════════════════════════════════════════════════════════════
-- ClassMind AI — Migration 003
-- Timetable scheduling (admin) + Live classroom part-locks (teacher)
--
-- 1. master_timetable gains day_of_week / start_time / end_time so admins can
--    schedule real weekly slots. Rows with NULL day keep working as plain
--    teacher→subject assignments (backwards compatible with migration 001).
-- 2. active_sessions becomes a live-classroom lock: is_active, part,
--    last_ping (heartbeat), ended_at, kicked_by.
-- 3. Only ONE live class per part at any moment (partial unique index) —
--    a teacher from the same part cannot start while another is live.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. MASTER TIMETABLE → weekly schedule ─────────────────────────────────

ALTER TABLE public.master_timetable
    ADD COLUMN IF NOT EXISTS day_of_week TEXT,
    ADD COLUMN IF NOT EXISTS start_time TEXT,
    ADD COLUMN IF NOT EXISTS end_time TEXT;

-- A teacher can hold multiple weekly slots for the same subject
ALTER TABLE public.master_timetable
    DROP CONSTRAINT IF EXISTS master_timetable_teacher_id_subject_id_key;

CREATE INDEX IF NOT EXISTS idx_master_timetable_day
    ON public.master_timetable(day_of_week);

-- ─── 2. ACTIVE SESSIONS → live classroom locks ──────────────────────────────

ALTER TABLE public.active_sessions
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS part TEXT,
    ADD COLUMN IF NOT EXISTS last_ping TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kicked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_active_sessions_active
    ON public.active_sessions(is_active) WHERE is_active = true;

-- Denormalise the subject's part onto every session row (used by the lock).
-- Keeps working for edge-function inserts that don't know the part.
CREATE OR REPLACE FUNCTION public.set_session_part()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.part IS NULL THEN
        SELECT part INTO NEW.part FROM public.subjects WHERE id = NEW.subject_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_active_session_insert ON public.active_sessions;
CREATE TRIGGER on_active_session_insert
    BEFORE INSERT ON public.active_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_session_part();

-- Hard guarantee: at most one LIVE class per part at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_sessions_part_live
    ON public.active_sessions(part) WHERE is_active = true;

-- Friendly pre-check used by the INSERT policy (SECURITY DEFINER avoids
-- RLS self-reference recursion inside policies).
CREATE OR REPLACE FUNCTION public.is_part_free_for_recording(subject_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    target_part TEXT;
BEGIN
    SELECT part INTO target_part FROM public.subjects WHERE id = subject_uuid;
    IF target_part IS NULL THEN
        RETURN TRUE;
    END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM public.active_sessions a
        WHERE a.is_active = TRUE
          AND a.part = target_part
          AND a.teacher_id <> auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 3. ROW LEVEL SECURITY ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Edge functions can manage active sessions"
    ON public.active_sessions;

-- Anyone signed-in can see WHO is live right now (needed for part locks);
-- full history stays visible to the owner and to admins.
CREATE POLICY "Authenticated users can view live sessions"
    ON public.active_sessions FOR SELECT
    USING (
        is_active = TRUE
        OR auth.uid() = teacher_id
        OR EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = auth.uid() AND up.role = 'admin' AND up.is_approved = TRUE
        )
    );

-- A teacher can only go live when their part is free.
CREATE POLICY "Teachers can start a live session in a free part"
    ON public.active_sessions FOR INSERT
    WITH CHECK (
        auth.uid() = teacher_id
        AND public.is_part_free_for_recording(subject_id)
    );

-- Session owner can heartbeat / end their own session.
CREATE POLICY "Teachers can update their own live session"
    ON public.active_sessions FOR UPDATE
    USING (auth.uid() = teacher_id)
    WITH CHECK (auth.uid() = teacher_id);

-- Admins can manage everything (force-end stuck locks, history, etc.).
CREATE POLICY "Admins can manage live sessions"
    ON public.active_sessions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = auth.uid() AND up.role = 'admin' AND up.is_approved = TRUE
        )
    );

-- A teacher may force-end another teacher's session ONLY when it has gone
-- stale (no heartbeat for 2+ minutes) AND the session belongs to a part the
-- teacher is assigned to teach. Live sessions of a part-mate cannot be ended.
CREATE POLICY "Teachers can force-end stale sessions in their part"
    ON public.active_sessions FOR UPDATE
    USING (
        is_active = TRUE
        AND last_ping < NOW() - INTERVAL '2 minutes'
        AND EXISTS (
            SELECT 1 FROM public.master_timetable mt
            JOIN public.subjects s ON s.id = mt.subject_id
            WHERE mt.teacher_id = auth.uid()
              AND s.part = active_sessions.part
        )
    )
    WITH CHECK (TRUE);

CREATE POLICY "Teachers can delete their own session rows"
    ON public.active_sessions FOR DELETE
    USING (auth.uid() = teacher_id);

-- ─── 4. REALTIME ───────────────────────────────────────────────────────────
-- Teachers and admins subscribe to lock changes the instant they happen.

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.master_timetable;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;
