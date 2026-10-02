ALTER TABLE public.exercise_submissions
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;