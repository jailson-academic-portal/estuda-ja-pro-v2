CREATE OR REPLACE FUNCTION public.current_institution_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;

CREATE POLICY "profiles_select_policy"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    (public.has_role(auth.uid(), 'teacher'::public.app_role)
     OR public.has_role(auth.uid(), 'gestor'::public.app_role)
     OR public.has_role(auth.uid(), 'institution'::public.app_role))
    AND institution_id = public.current_institution_id()
  )
);