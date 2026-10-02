DO $$
DECLARE
  next_value bigint;
BEGIN
  CREATE SEQUENCE IF NOT EXISTS public.assessment_control_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    NO CYCLE;

  ALTER SEQUENCE public.assessment_control_seq
    MAXVALUE 2147483647
    NO CYCLE;

  SELECT GREATEST(1, COALESCE(MAX(control_sequence), 0) + 1)
    INTO next_value
    FROM public.assessments;

  EXECUTE format('ALTER SEQUENCE public.assessment_control_seq RESTART WITH %s', next_value);

  UPDATE public.assessments
     SET control_sequence = nextval('public.assessment_control_seq'::regclass)
   WHERE control_sequence IS NULL;

  SELECT GREATEST(1, COALESCE(MAX(control_sequence), 0) + 1)
    INTO next_value
    FROM public.assessments;

  EXECUTE format('ALTER SEQUENCE public.assessment_control_seq RESTART WITH %s', next_value);
END $$;

ALTER TABLE public.assessments
  ALTER COLUMN control_sequence SET DEFAULT nextval('public.assessment_control_seq'::regclass);

GRANT USAGE, SELECT ON SEQUENCE public.assessment_control_seq TO authenticated;
GRANT ALL ON SEQUENCE public.assessment_control_seq TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_sequence_key
  ON public.assessments (control_sequence)
  WHERE control_sequence IS NOT NULL;