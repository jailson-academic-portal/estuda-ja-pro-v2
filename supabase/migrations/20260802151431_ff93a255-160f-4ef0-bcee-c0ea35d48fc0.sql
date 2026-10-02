-- Add deadline and penalty columns to clinical_cases
ALTER TABLE public.clinical_cases 
ADD COLUMN IF NOT EXISTS due_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS allow_late_submission boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric DEFAULT 0;

-- Ensure RLS and permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_cases TO authenticated;
GRANT ALL ON public.clinical_cases TO service_role;

DROP POLICY IF EXISTS "Teachers can manage their own cases" ON public.clinical_cases;
CREATE POLICY "Teachers can manage their own cases"
ON public.clinical_cases
FOR ALL
TO authenticated
USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can view cases in their disciplines" ON public.clinical_cases;
CREATE POLICY "Students can view cases in their disciplines"
ON public.clinical_cases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE student_id = auth.uid()
    AND discipline_id = clinical_cases.discipline_id
  )
);
