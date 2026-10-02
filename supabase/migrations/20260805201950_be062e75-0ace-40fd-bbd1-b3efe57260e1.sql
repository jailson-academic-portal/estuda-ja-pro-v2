ALTER TABLE public.grade_entries ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Reload schema cache to reflect changes immediately
NOTIFY pgrst, 'reload schema';
