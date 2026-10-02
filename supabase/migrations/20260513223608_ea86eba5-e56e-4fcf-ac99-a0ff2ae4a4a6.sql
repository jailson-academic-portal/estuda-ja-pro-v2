ALTER TABLE public.attendance_sessions
ADD COLUMN IF NOT EXISTS code_window_minutes integer NOT NULL DEFAULT 15;