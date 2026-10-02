-- Itens estruturados extraídos do Plano de Aula (banco de temas) para consumo
-- automático por Atividades Extras, SimulSaúde e Trabalhos Acadêmicos.
CREATE TABLE IF NOT EXISTS public.lesson_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  plan_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('case_study','clinical_case','academic_work','extra_activity')),
  title text NOT NULL,
  description text,
  module_number integer,
  module_title text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_plan_items_discipline_kind
  ON public.lesson_plan_items (discipline_id, kind, module_number);
CREATE INDEX IF NOT EXISTS idx_lesson_plan_items_plan
  ON public.lesson_plan_items (plan_generation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_plan_items TO authenticated;
GRANT ALL ON public.lesson_plan_items TO service_role;

ALTER TABLE public.lesson_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_plan_items_select_members"
  ON public.lesson_plan_items FOR SELECT TO authenticated
  USING (public.is_discipline_member(discipline_id, auth.uid()));

CREATE POLICY "lesson_plan_items_insert_teacher"
  ON public.lesson_plan_items FOR INSERT TO authenticated
  WITH CHECK (public.is_discipline_teacher(discipline_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "lesson_plan_items_update_teacher"
  ON public.lesson_plan_items FOR UPDATE TO authenticated
  USING (public.is_discipline_teacher(discipline_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_discipline_teacher(discipline_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "lesson_plan_items_delete_teacher"
  ON public.lesson_plan_items FOR DELETE TO authenticated
  USING (public.is_discipline_teacher(discipline_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

-- Índice auxiliar para localizar o trabalho acadêmico originado do plano.
CREATE INDEX IF NOT EXISTS idx_academic_works_source_generation
  ON public.academic_works (discipline_id, source_generation_id);