ALTER TABLE public.assessments DROP COLUMN IF EXISTS assessment_date;
ALTER TABLE public.assessments ADD COLUMN assessment_date timestamptz;
