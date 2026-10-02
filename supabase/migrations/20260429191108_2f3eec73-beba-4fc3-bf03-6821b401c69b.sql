ALTER TABLE public.grade_structures
  ADD COLUMN IF NOT EXISTS recovery_average numeric,
  ADD COLUMN IF NOT EXISTS grade_scale integer NOT NULL DEFAULT 10;

-- Backfill recovery_average for existing rows: passing - 2 (clamped to 0)
UPDATE public.grade_structures
SET recovery_average = GREATEST(passing_average - 2, 0)
WHERE recovery_average IS NULL;

-- Validation trigger: grade_scale must be 10 or 100; recovery_average <= passing_average; both within scale
CREATE OR REPLACE FUNCTION public.validate_grade_structure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.grade_scale NOT IN (10, 100) THEN
    RAISE EXCEPTION 'grade_scale must be 10 or 100';
  END IF;
  IF NEW.passing_average IS NULL OR NEW.passing_average < 0 OR NEW.passing_average > NEW.grade_scale THEN
    RAISE EXCEPTION 'passing_average must be between 0 and grade_scale';
  END IF;
  IF NEW.recovery_average IS NOT NULL AND (NEW.recovery_average < 0 OR NEW.recovery_average > NEW.passing_average) THEN
    RAISE EXCEPTION 'recovery_average must be between 0 and passing_average';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_grade_structure_trg ON public.grade_structures;
CREATE TRIGGER validate_grade_structure_trg
BEFORE INSERT OR UPDATE ON public.grade_structures
FOR EACH ROW EXECUTE FUNCTION public.validate_grade_structure();