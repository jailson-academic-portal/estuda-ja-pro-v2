ALTER TABLE public.clinical_cases
  ADD COLUMN IF NOT EXISTS scenario text,
  ADD COLUMN IF NOT EXISTS objectives text,
  ADD COLUMN IF NOT EXISTS module_number integer,
  ADD COLUMN IF NOT EXISTS source_generation_id uuid;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_source_generation ON public.clinical_cases (source_generation_id) WHERE source_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_source_generation ON public.activities (source_generation_id) WHERE source_generation_id IS NOT NULL;