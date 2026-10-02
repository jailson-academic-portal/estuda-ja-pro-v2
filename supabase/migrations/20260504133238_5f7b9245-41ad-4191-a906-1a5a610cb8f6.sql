ALTER TABLE public.disciplines
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS week_days text[],
  ADD COLUMN IF NOT EXISTS class_start_time time,
  ADD COLUMN IF NOT EXISTS class_end_time time;