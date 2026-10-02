ALTER TABLE public.disciplines ADD COLUMN IF NOT EXISTS visible_modules jsonb;

CREATE TABLE IF NOT EXISTS public.discipline_lab_simulations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    discipline_id uuid REFERENCES public.disciplines(id) ON DELETE CASCADE NOT NULL,
    module_type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL, -- O enunciado clínico/contextualização
    questions jsonb NOT NULL DEFAULT '[]'::jsonb, -- Questões discursivas/objetivas
    image_url text, -- Campo de upload de imagem opcional
    created_at timestamptz DEFAULT now() NOT NULL,
    teacher_id uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.discipline_lab_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id uuid REFERENCES public.discipline_lab_simulations(id) ON DELETE CASCADE NOT NULL,
    student_id uuid REFERENCES auth.users(id) NOT NULL,
    answers jsonb NOT NULL DEFAULT '[]'::jsonb,
    grade numeric(4,2),
    feedback text,
    submitted_at timestamptz DEFAULT now() NOT NULL,
    diary_column_id uuid -- Referência para lançamento no diário
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_simulations TO authenticated;
GRANT ALL ON public.discipline_lab_simulations TO service_role;
ALTER TABLE public.discipline_lab_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage lab simulations" ON public.discipline_lab_simulations
    FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Students can view simulations" ON public.discipline_lab_simulations
    FOR SELECT TO authenticated USING (true); -- Ideally scoped to enrolled students, but this is a starting point.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_lab_submissions TO authenticated;
GRANT ALL ON public.discipline_lab_submissions TO service_role;
ALTER TABLE public.discipline_lab_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can submit lab answers" ON public.discipline_lab_submissions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Users can view their own submissions" ON public.discipline_lab_submissions
    FOR SELECT TO authenticated USING (auth.uid() = student_id OR public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can grade submissions" ON public.discipline_lab_submissions
    FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));
