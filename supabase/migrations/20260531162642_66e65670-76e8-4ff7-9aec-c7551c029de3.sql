CREATE TABLE IF NOT EXISTS public.assessment_control_reservations (
  control_number text PRIMARY KEY,
  scope_key text NOT NULL,
  control_year integer NOT NULL,
  control_sequence integer NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.assessment_control_reservations TO service_role;
REVOKE ALL ON public.assessment_control_reservations FROM anon;
REVOKE ALL ON public.assessment_control_reservations FROM authenticated;

ALTER TABLE public.assessment_control_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct client access to assessment reservations" ON public.assessment_control_reservations;
CREATE POLICY "No direct client access to assessment reservations" ON public.assessment_control_reservations
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_assessment_control_reservations_scope_year
  ON public.assessment_control_reservations (scope_key, control_year, control_sequence);

INSERT INTO public.assessment_control_reservations(control_number, scope_key, control_year, control_sequence)
SELECT a.control_number,
       coalesce(a.control_scope_key, 'legacy'),
       coalesce(a.control_year, EXTRACT(YEAR FROM a.created_at)::integer),
       coalesce(a.control_sequence, 1)
  FROM public.assessments a
 WHERE a.control_number IS NOT NULL
ON CONFLICT (control_number) DO NOTHING;

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

  PERFORM pg_advisory_xact_lock(hashtext('assessment_control_global'), v_year);
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

    BEGIN
      INSERT INTO public.assessment_control_reservations(control_number, scope_key, control_year, control_sequence)
      VALUES (v_number, v_scope, v_year, v_seq);

      control_sequence := v_seq;
      control_number := v_number;
      control_year := v_year;
      control_scope_key := v_scope;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO service_role;