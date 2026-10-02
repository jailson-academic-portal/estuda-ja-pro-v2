ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS programmatic_content text,
  ADD COLUMN IF NOT EXISTS pedagogical_observations text;