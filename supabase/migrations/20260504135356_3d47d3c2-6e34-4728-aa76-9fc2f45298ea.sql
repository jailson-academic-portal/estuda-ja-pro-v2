ALTER TABLE public.disciplines
  ALTER COLUMN status SET DEFAULT 'active'::public.discipline_status;