ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS assessment_schedule text;