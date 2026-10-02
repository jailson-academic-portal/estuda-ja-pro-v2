ALTER TABLE public.disciplines ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY teacher_id ORDER BY created_at DESC) AS rn
  FROM public.disciplines
)
UPDATE public.disciplines d SET sort_order = r.rn FROM ranked r WHERE d.id = r.id;
CREATE INDEX IF NOT EXISTS idx_disciplines_teacher_sort ON public.disciplines (teacher_id, sort_order);