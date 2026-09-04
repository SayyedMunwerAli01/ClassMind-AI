-- Migration 006: Admin Dashboard enhancements
-- Student part assignment, subject CRUD, bulk enrollment, user management

-- ── Add student_part to user_profiles ──
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS student_part TEXT DEFAULT NULL;

-- ── Subject UPDATE helper (admin) ──
CREATE OR REPLACE FUNCTION public.admin_update_subject(
  p_subject_id UUID,
  p_name TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_part TEXT DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  UPDATE public.subjects SET
    subject_name = COALESCE(p_name, subject_name),
    subject_code = COALESCE(p_code, subject_code),
    part = COALESCE(p_part, part)
  WHERE id = p_subject_id;

  RETURN (SELECT row_to_json(s) FROM public.subjects s WHERE s.id = p_subject_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Subject DELETE (cascades enrollments, timetable, notes, todos) ──
CREATE OR REPLACE FUNCTION public.admin_delete_subject(p_subject_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM public.student_enrollments WHERE subject_id = p_subject_id;
  DELETE FROM public.master_timetable WHERE subject_id = p_subject_id;
  DELETE FROM public.global_todos WHERE subject_id = p_subject_id;
  DELETE FROM public.daily_notes WHERE subject_id = p_subject_id;
  DELETE FROM public.active_sessions WHERE subject_id = p_subject_id;
  DELETE FROM public.session_transcripts WHERE subject_id = p_subject_id;
  DELETE FROM public.subjects WHERE id = p_subject_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Bulk enroll a student in multiple subjects ──
CREATE OR REPLACE FUNCTION public.admin_bulk_enroll(
  p_student_id UUID,
  p_subject_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_sid UUID;
BEGIN
  FOREACH v_sid IN ARRAY p_subject_ids LOOP
    INSERT INTO public.student_enrollments (student_id, subject_id)
    VALUES (p_student_id, v_sid)
    ON CONFLICT (student_id, subject_id) DO NOTHING;
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Unenroll a student from a subject ──
CREATE OR REPLACE FUNCTION public.admin_unenroll(
  p_student_id UUID,
  p_subject_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM public.student_enrollments
  WHERE student_id = p_student_id AND subject_id = p_subject_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Set student part (updates user_profiles.student_part) ──
CREATE OR REPLACE FUNCTION public.admin_set_student_part(
  p_user_id UUID,
  p_part TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.user_profiles SET student_part = p_part WHERE id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Delete user (admin) ──
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM public.user_profiles WHERE id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Change user role (admin) ──
CREATE OR REPLACE FUNCTION public.admin_change_role(
  p_user_id UUID,
  p_new_role TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.user_profiles SET role = p_new_role WHERE id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
