CREATE TABLE public.assessment_question_audits (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid references public.assessment_questions(id) on delete cascade,
  version_label text not null,
  position integer not null,
  concept text,
  lesson_tag text,
  status text not null,
  message text,
  concept_options jsonb not null default '[]'::jsonb,
  declared_level text,
  detected_level text,
  suggested_prompt text,
  resolution text not null default 'pending',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

CREATE INDEX idx_aqa_assessment ON public.assessment_question_audits(assessment_id, resolution);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_question_audits TO authenticated;
GRANT ALL ON public.assessment_question_audits TO service_role;

ALTER TABLE public.assessment_question_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers read own assessment audits"
ON public.assessment_question_audits FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assessments a
  JOIN public.disciplines d ON d.id = a.discipline_id
  WHERE a.id = assessment_question_audits.assessment_id
    AND (d.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
));