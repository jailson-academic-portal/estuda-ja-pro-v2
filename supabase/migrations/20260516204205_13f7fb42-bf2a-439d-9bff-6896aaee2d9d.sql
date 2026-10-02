CREATE OR REPLACE FUNCTION public.generate_discipline_alpha_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  letters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  candidate text;
  i int;
  tries int := 0;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(letters, floor(random() * length(letters) + 1)::int, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.disciplines WHERE code = candidate);
    tries := tries + 1;
    IF tries > 100 THEN
      RAISE EXCEPTION 'Não foi possível gerar código de disciplina único';
    END IF;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_discipline_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 OR upper(trim(NEW.code)) !~ '^[A-Z]+$' THEN
    NEW.code := public.generate_discipline_alpha_code();
  ELSE
    NEW.code := upper(trim(NEW.code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_discipline_code_before_insert ON public.disciplines;
CREATE TRIGGER set_discipline_code_before_insert
BEFORE INSERT ON public.disciplines
FOR EACH ROW
EXECUTE FUNCTION public.set_discipline_code();

DO $$
DECLARE
  r record;
  new_code text;
BEGIN
  FOR r IN SELECT id, code FROM public.disciplines WHERE code IS NULL OR upper(trim(code)) !~ '^[A-Z]+$' LOOP
    new_code := public.generate_discipline_alpha_code();
    UPDATE public.disciplines SET code = new_code WHERE id = r.id;
  END LOOP;
END;
$$;