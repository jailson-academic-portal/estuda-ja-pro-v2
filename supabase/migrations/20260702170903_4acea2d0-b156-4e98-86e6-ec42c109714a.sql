ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS source_generation_id uuid;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS source_generation_id uuid;
ALTER TABLE public.academic_works ADD COLUMN IF NOT EXISTS source_generation_id uuid;

CREATE INDEX IF NOT EXISTS materials_source_generation_id_idx ON public.materials (source_generation_id);
CREATE INDEX IF NOT EXISTS activities_source_generation_id_idx ON public.activities (source_generation_id);
CREATE INDEX IF NOT EXISTS academic_works_source_generation_id_idx ON public.academic_works (source_generation_id);