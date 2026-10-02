-- 1. Restrict invitation creation to institution-role users only.
DROP POLICY IF EXISTS "Institutions insert own invitations" ON public.invitations;
CREATE POLICY "Institutions insert own invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND kind = 'teacher'::invitation_kind
    AND public.has_role(auth.uid(), 'institution'::app_role)
  );

-- 2. Remove teachers' direct full-row read of student profiles (which exposed email).
DROP POLICY IF EXISTS "Teachers see students in their disciplines" ON public.profiles;

-- 3. Provide teachers (and self/admin/institution) a safe, email-free directory of profiles.
CREATE OR REPLACE VIEW public.student_directory AS
SELECT
  p.id,
  p.name,
  p.enrollment_number,
  p.profile_type,
  p.institution_id,
  p.logo_url,
  p.status
FROM public.profiles p
WHERE
  p.id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR (public.has_role(auth.uid(), 'institution'::app_role) AND p.institution_id = public.current_institution_id())
  OR (
    public.has_role(auth.uid(), 'teacher'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.discipline_students ds
      JOIN public.disciplines d ON d.id = ds.discipline_id
      WHERE ds.student_id = p.id AND d.teacher_id = auth.uid()
    )
  );

GRANT SELECT ON public.student_directory TO authenticated;