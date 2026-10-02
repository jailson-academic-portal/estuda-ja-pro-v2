ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS starts_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.attendance_sessions SET starts_at = created_at WHERE starts_at IS NULL OR starts_at = created_at;