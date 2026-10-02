ALTER TABLE public.academic_work_submissions
  ADD COLUMN IF NOT EXISTS submission_text text;

CREATE INDEX IF NOT EXISTS idx_disciplines_teacher_status_sort
  ON public.disciplines (teacher_id, status, sort_order, created_at DESC);