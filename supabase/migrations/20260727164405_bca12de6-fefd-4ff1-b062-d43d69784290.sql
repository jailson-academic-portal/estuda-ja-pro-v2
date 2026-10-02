UPDATE public.discipline_settings SET attendance_window_hours = 72 WHERE attendance_window_hours <> 72;
UPDATE public.attendance_sessions SET window_hours = 72 WHERE window_hours <> 72 AND finalized_at IS NULL;
ALTER TABLE public.discipline_settings ALTER COLUMN attendance_window_hours SET DEFAULT 72;
ALTER TABLE public.attendance_sessions ALTER COLUMN window_hours SET DEFAULT 72;