ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS max_group_size integer,
  ADD COLUMN IF NOT EXISTS allow_late boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric,
  ADD COLUMN IF NOT EXISTS diary_assessment_id text;

ALTER TABLE public.academic_works
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS max_group_size integer,
  ADD COLUMN IF NOT EXISTS allow_late boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric,
  ADD COLUMN IF NOT EXISTS diary_assessment_id text;

DO $$ BEGIN
  CREATE TYPE public.group_activity_kind AS ENUM ('activity','work');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.activity_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline_id uuid NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL,
  activity_kind public.group_activity_kind NOT NULL,
  leader_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.activity_groups TO authenticated;
GRANT ALL ON public.activity_groups TO service_role;

ALTER TABLE public.activity_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members and teachers read groups"
ON public.activity_groups FOR SELECT TO authenticated
USING (
  leader_id = auth.uid()
  OR auth.uid() = ANY(member_ids)
  OR public.is_discipline_teacher(discipline_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    public.has_role(auth.uid(), 'institution'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.disciplines d
      WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_groups_activity ON public.activity_groups (activity_id, activity_kind);
CREATE INDEX IF NOT EXISTS idx_activity_groups_discipline ON public.activity_groups (discipline_id);