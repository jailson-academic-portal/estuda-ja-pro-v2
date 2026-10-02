DROP TRIGGER IF EXISTS trg_enforce_free_discipline_limit ON public.disciplines;

ALTER TABLE public.disciplines ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.disciplines ALTER COLUMN status TYPE text USING COALESCE(NULLIF(status::text, ''), 'active');
ALTER TABLE public.disciplines ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.disciplines ALTER COLUMN status SET NOT NULL;

CREATE TRIGGER trg_enforce_free_discipline_limit
BEFORE INSERT OR UPDATE OF status ON public.disciplines
FOR EACH ROW
EXECUTE FUNCTION public.enforce_free_plan_discipline_limit();