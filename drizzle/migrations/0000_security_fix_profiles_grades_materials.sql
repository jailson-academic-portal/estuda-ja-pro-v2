-- 1) profiles: remove blanket read, add scoped policies
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;

DROP POLICY IF EXISTS "profiles_select_scoped" ON public.profiles;
CREATE POLICY "profiles_select_scoped" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'institution'::public.app_role)
    AND institution_id IS NOT NULL
    AND institution_id = public.current_institution_id()
  )
  OR (
    public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.discipline_students ds
      JOIN public.disciplines d ON d.id = ds.discipline_id
      WHERE ds.student_id = profiles.id AND d.teacher_id = auth.uid()
    )
  )
);

-- 2) profiles: block self-service privilege escalation on sensitive columns
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.profile_type := OLD.profile_type;
  NEW.institution_id := OLD.institution_id;
  NEW.enrollment_number := OLD.enrollment_number;
  NEW.status := OLD.status;
  NEW.id := OLD.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- 3) grade_entries: drop role-only (non-ownership) policies
DROP POLICY IF EXISTS "Teachers manage grades" ON public.grade_entries;
DROP POLICY IF EXISTS "grade_entries_student_select" ON public.grade_entries;

-- 4) materials: drop role-only policy
DROP POLICY IF EXISTS "Teachers/Admins can manage materials" ON public.materials;