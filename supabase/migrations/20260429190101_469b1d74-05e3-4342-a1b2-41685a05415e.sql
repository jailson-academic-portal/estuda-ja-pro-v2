ALTER TABLE public.grade_structures
  ADD COLUMN IF NOT EXISTS recovery_config jsonb DEFAULT NULL;