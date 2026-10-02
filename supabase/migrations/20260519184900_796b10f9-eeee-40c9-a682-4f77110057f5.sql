
-- New status value for corrections in draft
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'corrected'
      AND enumtypid = 'public.submission_status'::regtype
  ) THEN
    ALTER TYPE public.submission_status ADD VALUE 'corrected';
  END IF;
END$$;

-- New notification kind for teacher when a student submits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'new_submission'
      AND enumtypid = 'public.notification_kind'::regtype
  ) THEN
    ALTER TYPE public.notification_kind ADD VALUE 'new_submission';
  END IF;
END$$;

-- Activity submissions: enrichment columns
ALTER TABLE public.activity_submissions
  ADD COLUMN IF NOT EXISTS ai_usage_report jsonb,
  ADD COLUMN IF NOT EXISTS ai_feedback_draft text,
  ADD COLUMN IF NOT EXISTS final_feedback text,
  ADD COLUMN IF NOT EXISTS final_score numeric,
  ADD COLUMN IF NOT EXISTS rubric_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS diary_assessment_id text,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Academic work submissions: enrichment columns
ALTER TABLE public.academic_work_submissions
  ADD COLUMN IF NOT EXISTS ai_usage_report jsonb,
  ADD COLUMN IF NOT EXISTS ai_feedback_draft text,
  ADD COLUMN IF NOT EXISTS final_feedback text,
  ADD COLUMN IF NOT EXISTS final_score numeric,
  ADD COLUMN IF NOT EXISTS rubric_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS diary_assessment_id text,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
