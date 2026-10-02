-- 1) Remove overly permissive (USING true / public role) SELECT policies
DROP POLICY IF EXISTS "permitir_leitura_profiles" ON public.profiles;
DROP POLICY IF EXISTS "allow_authenticated_read_profiles" ON public.profiles;
DROP POLICY IF EXISTS "assessments_select" ON public.assessments;
DROP POLICY IF EXISTS "assessments_select_policy" ON public.assessments;
DROP POLICY IF EXISTS "clinical_cases_select_policy" ON public.clinical_cases;
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
DROP POLICY IF EXISTS "exercises_select_policy" ON public.exercises;
DROP POLICY IF EXISTS "material_modules_select_policy" ON public.material_modules;
DROP POLICY IF EXISTS "materials_select_policy" ON public.materials;

-- 2) Ensure institution managers can still read clinical cases of their institution
DROP POLICY IF EXISTS "Institutions see clinical cases" ON public.clinical_cases;
CREATE POLICY "Institutions see clinical cases"
ON public.clinical_cases FOR SELECT TO authenticated
USING (
  public.discipline_institution_id(discipline_id) IS NOT NULL
  AND public.discipline_institution_id(discipline_id) = public.current_institution_id()
);

DROP POLICY IF EXISTS "Admins manage clinical cases" ON public.clinical_cases;
CREATE POLICY "Admins manage clinical cases"
ON public.clinical_cases FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Enable row level security on every affected table
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_diary_entries ENABLE ROW LEVEL SECURITY;

-- 4) Keep Data API grants explicit for authenticated users and server role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_generations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_diary_entries TO authenticated;

GRANT ALL ON public.activities TO service_role;
GRANT ALL ON public.ai_generations TO service_role;
GRANT ALL ON public.assessments TO service_role;
GRANT ALL ON public.attendance_records TO service_role;
GRANT ALL ON public.attendance_sessions TO service_role;
GRANT ALL ON public.clinical_cases TO service_role;
GRANT ALL ON public.discipline_students TO service_role;
GRANT ALL ON public.disciplines TO service_role;
GRANT ALL ON public.exercises TO service_role;
GRANT ALL ON public.grade_entries TO service_role;
GRANT ALL ON public.material_modules TO service_role;
GRANT ALL ON public.materials TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.student_diary_entries TO service_role;

REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.disciplines FROM anon;
REVOKE SELECT ON public.assessments FROM anon;
REVOKE SELECT ON public.clinical_cases FROM anon;
REVOKE SELECT ON public.exercises FROM anon;
REVOKE SELECT ON public.materials FROM anon;
REVOKE SELECT ON public.material_modules FROM anon;
REVOKE SELECT ON public.grade_entries FROM anon;
REVOKE SELECT ON public.student_diary_entries FROM anon;
