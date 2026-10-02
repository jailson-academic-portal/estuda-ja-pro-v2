ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS control_number text,
  ADD COLUMN IF NOT EXISTS control_year integer,
  ADD COLUMN IF NOT EXISTS control_scope_key text;

CREATE TABLE IF NOT EXISTS public.assessment_control_counters (
  scope_key text NOT NULL,
  control_year integer NOT NULL,
  next_sequence integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, control_year)
);

GRANT SELECT, INSERT, UPDATE ON public.assessment_control_counters TO authenticated;
GRANT ALL ON public.assessment_control_counters TO service_role;

ALTER TABLE public.assessment_control_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage assessment counters" ON public.assessment_control_counters;
CREATE POLICY "Admins manage assessment counters" ON public.assessment_control_counters
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Teachers manage assessment counters" ON public.assessment_control_counters;
CREATE POLICY "Teachers manage assessment counters" ON public.assessment_control_counters
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_number_key
  ON public.assessments (control_number)
  WHERE control_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_control_scope_year
  ON public.assessments (control_scope_key, control_year, control_sequence)
  WHERE control_scope_key IS NOT NULL AND control_year IS NOT NULL AND control_sequence IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_assessment_control(
  _discipline_id uuid,
  _module_name text,
  _issued_at timestamptz DEFAULT now()
)
RETURNS TABLE(control_sequence integer, control_number text, control_year integer, control_scope_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_institution_id uuid;
  v_year integer := EXTRACT(YEAR FROM _issued_at)::integer;
  v_month text := to_char(_issued_at, 'MM');
  v_yy text := to_char(_issued_at, 'YY');
  v_module text := lower(regexp_replace(coalesce(nullif(trim(_module_name), ''), 'sem-modulo'), '\s+', ' ', 'g'));
  v_scope text;
  v_seq integer;
  v_number text;
  v_guard integer := 0;
BEGIN
  SELECT d.institution_id
    INTO v_institution_id
    FROM public.disciplines d
   WHERE d.id = _discipline_id;

  v_scope := concat_ws(':', coalesce(v_institution_id::text, 'sem-instituicao'), _discipline_id::text, md5(v_module));

  PERFORM pg_advisory_xact_lock(hashtext(v_scope), v_year);

  INSERT INTO public.assessment_control_counters(scope_key, control_year, next_sequence)
  VALUES (v_scope, v_year, 1)
  ON CONFLICT (scope_key, control_year) DO NOTHING;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      RAISE EXCEPTION 'ASSESSMENT_CONTROL_EXHAUSTED: não foi possível reservar número de avaliação único';
    END IF;

    UPDATE public.assessment_control_counters
       SET next_sequence = next_sequence + 1,
           updated_at = now()
     WHERE scope_key = v_scope
       AND control_year = v_year
     RETURNING next_sequence - 1 INTO v_seq;

    v_number := v_month || lpad(v_seq::text, 4, '0') || v_yy;

    IF NOT EXISTS (
      SELECT 1 FROM public.assessments a WHERE a.control_number = v_number
    ) THEN
      control_sequence := v_seq;
      control_number := v_number;
      control_year := v_year;
      control_scope_key := v_scope;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO service_role;