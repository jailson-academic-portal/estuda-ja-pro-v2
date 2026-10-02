-- Add missing columns to discipline_lab_simulations
ALTER TABLE public.discipline_lab_simulations 
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS late_rule TEXT,
ADD COLUMN IF NOT EXISTS diary_column_id TEXT; -- Changed to TEXT as we are using a hybrid ID from grade_structures (id#subid)

-- Ensure RLS is enabled and policies are correct for virtual lab tables
ALTER TABLE public.discipline_lab_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_lab_submissions ENABLE ROW LEVEL SECURITY;

-- Simulation policies
DO $$ BEGIN
  CREATE POLICY "Teachers can manage their discipline simulations"
  ON public.discipline_lab_simulations
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    EXISTS (
      SELECT 1 FROM public.disciplines d
      WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Students can view published simulations"
  ON public.discipline_lab_simulations
  FOR SELECT
  TO authenticated
  USING (
    NOT is_draft AND
    EXISTS (
      SELECT 1 FROM public.discipline_students ds
      WHERE ds.discipline_id = discipline_id AND ds.student_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Submission policies
DO $$ BEGIN
  CREATE POLICY "Students can submit to their simulations"
  ON public.discipline_lab_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.discipline_lab_simulations s
      JOIN public.discipline_students ds ON ds.discipline_id = s.discipline_id
      WHERE s.id = simulation_id AND ds.student_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Students can view their own submissions"
  ON public.discipline_lab_submissions
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Teachers can view all submissions for their simulations"
  ON public.discipline_lab_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.discipline_lab_simulations s
      JOIN public.disciplines d ON d.id = s.discipline_id
      WHERE s.id = simulation_id AND d.teacher_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_simulations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_submissions TO authenticated;
GRANT ALL ON public.discipline_lab_simulations TO service_role;
GRANT ALL ON public.discipline_lab_submissions TO service_role;
