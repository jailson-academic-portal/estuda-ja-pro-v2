-- Enum para os módulos do Laboratório Virtual
CREATE TYPE public.lab_module_type AS ENUM (
  'biosseguranca', 
  'pre_analitica', 
  'hematologia', 
  'urinalise_fisica_quimica', 
  'urinalise_microscopica', 
  'microbiologia', 
  'bioquímica', 
  'mega_caso_integrador'
);

-- Configurações de Módulos por Disciplina
CREATE TABLE public.discipline_lab_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid REFERENCES public.disciplines(id) ON DELETE CASCADE NOT NULL,
  module_type public.lab_module_type NOT NULL,
  is_active boolean DEFAULT false,
  custom_media jsonb DEFAULT '[]'::jsonb, -- Array de URLs de imagens/arquivos
  updated_at timestamptz DEFAULT now(),
  UNIQUE(discipline_id, module_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_config TO authenticated;
GRANT ALL ON public.discipline_lab_config TO service_role;

ALTER TABLE public.discipline_lab_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage lab config" ON public.discipline_lab_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students can view active lab config" ON public.discipline_lab_config
  FOR SELECT TO authenticated
  USING (is_active = true AND EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = discipline_id AND ds.student_id = auth.uid()));

-- Adicionar colunas de controle de atraso e horário limite em atividades e casos clínicos
ALTER TABLE public.activities 
  ADD COLUMN IF NOT EXISTS due_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_tolerance_date date,
  ADD COLUMN IF NOT EXISTS late_tolerance_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_penalty_type text DEFAULT 'percentage' CHECK (late_penalty_type IN ('percentage', 'fixed'));

ALTER TABLE public.academic_works
  ADD COLUMN IF NOT EXISTS due_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_tolerance_date date,
  ADD COLUMN IF NOT EXISTS late_tolerance_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_penalty_type text DEFAULT 'percentage' CHECK (late_penalty_type IN ('percentage', 'fixed'));

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS due_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_tolerance_date date,
  ADD COLUMN IF NOT EXISTS late_tolerance_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS allow_late boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_penalty_type text DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS diary_assessment_id text;

ALTER TABLE public.clinical_cases
  ADD COLUMN IF NOT EXISTS due_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_tolerance_date date,
  ADD COLUMN IF NOT EXISTS late_tolerance_time time DEFAULT '23:59:59',
  ADD COLUMN IF NOT EXISTS late_penalty_type text DEFAULT 'percentage' CHECK (late_penalty_type IN ('percentage', 'fixed'));

NOTIFY pgrst, 'reload schema';
