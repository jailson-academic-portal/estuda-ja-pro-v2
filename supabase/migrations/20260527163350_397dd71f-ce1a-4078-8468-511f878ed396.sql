ALTER TABLE public.assessment_assignments
  ADD COLUMN IF NOT EXISTS bubble_layout jsonb;