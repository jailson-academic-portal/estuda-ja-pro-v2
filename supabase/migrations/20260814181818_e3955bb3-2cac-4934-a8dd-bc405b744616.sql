-- LIMPEZA TOTAL E RECONSTRUÇÃO DAS POLÍTICAS DE DISCIPLINAS E MATRÍCULAS
-- Objetivo: Eliminar qualquer possibilidade de recursão e garantir acesso para professor e aluno.

-- 1. Remover TODAS as políticas existentes para evitar conflitos
DROP POLICY IF EXISTS "disciplines_teacher_select" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_admin_select" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_student_select" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_access_policy_fixed" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers can manage their own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Admins can manage all disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
DROP POLICY IF EXISTS "Teachers can manage students in their disciplines" ON public.discipline_students;
DROP POLICY IF EXISTS "Admins can manage all discipline_students" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_self_select" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_admin_select" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_teacher_select" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_access_policy_fixed" ON public.discipline_students;

-- 2. Garantir que as tabelas tenham RLS ativo
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;

-- 3. Políticas para a tabela DISCIPLINES
-- A) Professor vê suas próprias disciplinas (DIRETO)
CREATE POLICY "disciplines_teacher_owner"
ON public.disciplines
FOR ALL -- Permite SELECT, INSERT, UPDATE, DELETE
TO authenticated
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

-- B) Administrador vê tudo (Usa SECURITY DEFINER has_role)
CREATE POLICY "disciplines_admin_all"
ON public.disciplines
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- C) Aluno vê disciplinas onde está matriculado (Usa SECURITY DEFINER check_student_enrollment)
-- Esta função consulta APENAS a tabela discipline_students, portanto não há recursão.
CREATE POLICY "disciplines_student_enrolled"
ON public.disciplines
FOR SELECT
TO authenticated
USING (public.check_student_enrollment(id, auth.uid()));

-- 4. Políticas para a tabela DISCIPLINE_STUDENTS
-- A) Aluno vê sua própria matrícula
CREATE POLICY "discipline_students_self"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- B) Admin gerencia tudo
CREATE POLICY "discipline_students_admin"
ON public.discipline_students
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- C) Professor vê alunos de SUAS disciplinas
-- Como o RLS de disciplines agora tem uma política direta para o professor (disciplines_teacher_owner),
-- esta subquery NÃO causará recursão infinita.
CREATE POLICY "discipline_students_teacher_view"
ON public.discipline_students
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines d 
    WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
  )
);

-- 5. Garantir Grants de API
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discipline_students TO authenticated;
GRANT ALL ON public.disciplines TO service_role;
GRANT ALL ON public.discipline_students TO service_role;
