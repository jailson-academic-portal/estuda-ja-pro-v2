-- Remove overly permissive clinical_cases SELECT policy; scoped policies remain
DROP POLICY IF EXISTS "Anyone authenticated can select cases" ON public.clinical_cases;

-- Consolidate duplicate/overlapping policies (policy drift)
DROP POLICY IF EXISTS "Teachers can manage their cases" ON public.clinical_cases;
DROP POLICY IF EXISTS "Teachers manage own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Students see enrolled disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers manage own material modules" ON public.material_modules;
DROP POLICY IF EXISTS "Students view modules in enrolled disciplines" ON public.material_modules;

-- Set immutable search_path on all public functions to satisfy linter 0011
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
      ))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;