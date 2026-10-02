-- Security Hardening: Revoke public execute on SECURITY DEFINER functions identified by linter
-- and fix remaining RLS issues.

-- 1. Revoke public/authenticated EXECUTE on specific SECURITY DEFINER functions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role') THEN
        REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, authenticated;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_subscription') THEN
        REVOKE EXECUTE ON FUNCTION public.check_subscription(uuid) FROM public, authenticated;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_institution') THEN
        REVOKE EXECUTE ON FUNCTION public.get_user_institution(uuid) FROM public, authenticated;
    END IF;
END $$;

-- 2. profiles_institution_role_no_select_policy: Fix missing SELECT policy for profiles
DROP POLICY IF EXISTS "Institutions can select profiles they manage" ON public.profiles;
CREATE POLICY "Institutions can select profiles they manage"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (auth.uid() = id) OR
  (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.profile_type = 'admin'
    )
  ) OR
  (
    EXISTS (
      SELECT 1 FROM public.profiles owner
      WHERE owner.id = auth.uid()
      AND owner.profile_type = 'institution'
      AND owner.institution_id = public.profiles.institution_id
    )
  )
);

-- 3. subscriptions_no_owner_read_policy: Ensure users can read their own subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can read their own subscriptions"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (subscriber_id = auth.uid());

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- 4. idor_content_hijack: reinforcing RLS on materials/exercises
DROP POLICY IF EXISTS "Professors can manage their own materials" ON public.materials;
CREATE POLICY "Professors can manage their own materials"
ON public.materials
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());
