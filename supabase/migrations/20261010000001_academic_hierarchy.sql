-- 1. HIERARQUIA ACADÊMICA: INSTITUIÇÕES, CURSOS, DISCIPLINAS, TURMAS E VINCULAÇÃO

-- Criar tipo para turno se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
        CREATE TYPE public.shift_type AS ENUM ('Manhã', 'Tarde', 'Noite', 'Integral');
    END IF;
END $$;

-- Instituições (Complemento)
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#0d9488';
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#14b8a6';

-- Cursos (Ajuste)
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS department TEXT;

-- Disciplinas (Ajuste)
ALTER TABLE public.disciplines ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE;
ALTER TABLE public.disciplines ADD COLUMN IF NOT EXISTS semester INTEGER;

-- Turmas
CREATE TABLE IF NOT EXISTS public.school_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    shift public.shift_type NOT NULL DEFAULT 'Manhã',
    period TEXT NOT NULL, -- ex: 2026.2
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Professores da Turma (Vinculação Professor + Disciplina + Turma)
CREATE TABLE IF NOT EXISTS public.class_professors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID REFERENCES public.school_classes(id) ON DELETE CASCADE NOT NULL,
    discipline_id UUID REFERENCES public.disciplines(id) ON DELETE CASCADE NOT NULL,
    professor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(class_id, discipline_id, professor_id)
);

-- Alunos da Turma (Enturmação)
CREATE TABLE IF NOT EXISTS public.class_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID REFERENCES public.school_classes(id) ON DELETE CASCADE NOT NULL,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    matricula TEXT,
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(class_id, student_id)
);

-- 2. GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_classes TO authenticated;
GRANT ALL ON public.school_classes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_professors TO authenticated;
GRANT ALL ON public.class_professors TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_students TO authenticated;
GRANT ALL ON public.class_students TO service_role;

-- 3. RLS
ALTER TABLE public.school_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_professors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

-- Políticas básicas (Instituição/Admin)
CREATE POLICY "Institutions can manage their classes" ON public.school_classes
    FOR ALL TO authenticated USING (true); -- Simplificado para o protótipo, o RLS definitivo deve checar has_role('admin')

CREATE POLICY "Institutions can manage class professors" ON public.class_professors
    FOR ALL TO authenticated USING (true);

CREATE POLICY "Institutions can manage class students" ON public.class_students
    FOR ALL TO authenticated USING (true);
