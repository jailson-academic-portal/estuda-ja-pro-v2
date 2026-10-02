-- 1. Fix EXPOSED_ROLE_DATA (user_roles_select_true_exposure)
DROP POLICY IF EXISTS "user_roles_select_authenticated" ON public.user_roles;

-- 2. Fix PUBLIC_USER_DATA (profiles_select_true_exposure)
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;

-- Ensure owner can read own profile
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_own') THEN
        CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
    END IF;
END $$;

-- 3. Fix MISSING_RLS_PROTECTION (disciplines_select_true_exposure)
DROP POLICY IF EXISTS "disciplines_simple_read_v3" ON public.disciplines;

-- 4. Fix STORAGE_OVERPERMISSIVE_POLICY (strict_storage_isolation_missing_bucket_scope)
DROP POLICY IF EXISTS "strict_storage_isolation" ON storage.objects;
CREATE POLICY "strict_storage_isolation" ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id IN ('materials', 'material_modules') AND 
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    EXISTS (
        SELECT 1 FROM public.disciplines d
        WHERE d.id::text = (storage.foldername(name))[1]
        AND (d.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  )
);

-- 5. Fix STORAGE_OVERPERMISSIVE_POLICY (submissions_teacher_role_broad_access)
DROP POLICY IF EXISTS "submissions_owner_strict" ON storage.objects;
CREATE POLICY "submissions_owner_strict" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'submissions' AND (
    (storage.foldername(name))[1] = auth.uid()::text OR
    EXISTS (
        SELECT 1 FROM public.disciplines d
        JOIN public.academic_works w ON w.discipline_id = d.id
        WHERE w.id::text = (storage.foldername(name))[1]
        AND (d.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  )
);