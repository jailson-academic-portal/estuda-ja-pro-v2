DROP VIEW IF EXISTS public.student_directory;

CREATE OR REPLACE FUNCTION public.get_profiles_safe(_ids uuid[])
RETURNS TABLE(id uuid, name text, enrollment_number text, profile_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.enrollment_number, p.profile_type::text
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND (
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
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_profiles_safe(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profiles_safe(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_safe(uuid[]) TO authenticated;