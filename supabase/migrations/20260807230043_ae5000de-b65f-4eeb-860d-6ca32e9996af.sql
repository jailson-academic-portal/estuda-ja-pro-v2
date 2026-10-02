CREATE OR REPLACE FUNCTION public.is_admin_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND p.profile_type = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_profile(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_profile(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles
FOR SELECT TO authenticated
USING (public.is_admin_profile(auth.uid()));
