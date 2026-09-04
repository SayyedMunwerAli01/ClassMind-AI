-- ═══════════════════════════════════════════════════════════════════════════
-- ClassMind AI — Migration 004
-- User profiles: avatar images, Google sign-up support, protected fields
-- + public `avatars` storage bucket
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. AVATAR COLUMN ──────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ─── 2. GOOGLE SIGN-UP SUPPORT ─────────────────────────────────────────────
-- Google accounts don't send full_name/role metadata — they send `name` +
-- `avatar_url`. Fall back gracefully so every signup path gets a full profile.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
    user_name TEXT;
    user_avatar TEXT;
BEGIN
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
    user_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
    );
    user_avatar := NEW.raw_user_meta_data->>'avatar_url';

    INSERT INTO public.user_profiles (id, full_name, role, avatar_url)
    VALUES (NEW.id, user_name, user_role, user_avatar);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. PROTECTED PROFILE FIELDS ───────────────────────────────────────────
-- Users may edit their own name and avatar, but never role / approval /
-- suspension — otherwise anyone could self-promote to admin.

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

    IF NEW.role IS DISTINCT FROM OLD.role
        OR NEW.is_approved IS DISTINCT FROM OLD.is_approved
        OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
        RAISE EXCEPTION 'Protected profile fields cannot be changed';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_user_profile_fields ON public.user_profiles;
CREATE TRIGGER protect_user_profile_fields
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- ─── 4. AVATARS STORAGE BUCKET ─────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "Avatar images are publicly viewable" ON storage.objects;
CREATE POLICY "Avatar images are publicly viewable"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can replace their own avatar" ON storage.objects;
CREATE POLICY "Users can replace their own avatar"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- ─── 5. REALTIME ───────────────────────────────────────────────────────────
-- Lets the Pending Approval screen react the moment an admin approves.

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;
