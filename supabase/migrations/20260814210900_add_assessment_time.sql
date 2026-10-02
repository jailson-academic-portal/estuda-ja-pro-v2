-- Change assessment_date from date to timestamptz to support time tracking
ALTER TABLE public.assessments 
  ALTER COLUMN assessment_date TYPE timestamptz 
  USING assessment_date::timestamptz;
