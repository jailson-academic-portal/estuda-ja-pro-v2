DO $$
DECLARE
  next_value integer;
BEGIN
  SELECT GREATEST(1, COALESCE(MAX(control_sequence), COUNT(*)::integer, 0) + 1)
    INTO next_value
    FROM public.assessments;

  EXECUTE format('ALTER SEQUENCE public.assessment_control_seq RESTART WITH %s', next_value);
END $$;

ALTER TABLE public.assessments
  ALTER COLUMN control_sequence SET DEFAULT nextval('public.assessment_control_seq'::regclass);