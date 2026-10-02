ALTER TABLE public.assessment_assignments
  ADD COLUMN IF NOT EXISTS question_order text[],
  ADD COLUMN IF NOT EXISTS option_orders jsonb,
  ADD COLUMN IF NOT EXISTS answer_key jsonb;