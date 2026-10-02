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

REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_assessment_control(uuid, text, timestamptz) TO service_role;