-- ═══════════════════════════════════════════════════════════════════════════
-- ClassMind AI — Migration 005
-- Google OAuth can't carry sign-up metadata through the redirect, so the role
-- picked on the Register page is applied once, right after the account is
-- created (10-minute window). 'admin' can never be self-assigned.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- Approved admins manage everyone (approval / suspension workflow)
    IF EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin' AND is_approved = TRUE
    ) THEN
        RETURN NEW;
    END IF;

    -- Sign-up completion window: a brand-new, unapproved account may still
    -- switch between student/teacher (e.g. the role chosen before Google
    -- redirected). Role 'admin' and approval flags stay untouchable.
    IF OLD.role = 'student'
        AND NOT OLD.is_approved
        AND OLD.created_at > NOW() - INTERVAL '10 minutes'
        AND NEW.role IN ('student', 'teacher')
        AND NEW.is_approved = OLD.is_approved
        AND NEW.is_suspended = OLD.is_suspended THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.is_approved IS DISTINCT FROM OLD.is_approved
        OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
        RAISE EXCEPTION 'Protected profile fields cannot be changed';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
