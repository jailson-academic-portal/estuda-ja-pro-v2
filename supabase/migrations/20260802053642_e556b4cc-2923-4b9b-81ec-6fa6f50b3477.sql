DROP POLICY IF EXISTS "Institutions can select profiles they manage" ON public.profiles;

CREATE POLICY "Institutions can select profiles they manage"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'institution'::public.app_role)
    AND institution_id IS NOT NULL
    AND institution_id = public.current_institution_id()
  )
);