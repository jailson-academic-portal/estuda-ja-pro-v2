CREATE SEQUENCE IF NOT EXISTS public.assessment_control_seq
  AS integer
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 9999
  CYCLE;

GRANT USAGE, SELECT ON SEQUENCE public.assessment_control_seq TO authenticated;
GRANT ALL ON SEQUENCE public.assessment_control_seq TO service_role;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS control_sequence integer;

CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_sequence_key
  ON public.assessments (control_sequence)
  WHERE control_sequence IS NOT NULL;