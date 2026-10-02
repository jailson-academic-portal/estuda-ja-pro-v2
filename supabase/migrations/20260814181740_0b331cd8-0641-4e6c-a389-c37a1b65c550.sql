-- CORREÇÃO DEFINITIVA DE RECURSÃO RLS (42P17)
-- A recursão ocorria porque uma única política tentava validar múltiplos papéis usando subqueries recursivas.
-- Dividimos em políticas atômicas e usamos a função SECURITY DEFINER que já criamos para alunos.

-- 1. Limpar políticas antigas na tabela disciplines
DROP POLICY IF EXISTS "disciplines_access_policy_fixed" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_membership_select" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_select_policy_v2" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_teacher_direct" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_admin_direct" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_student_enrollment" ON public.disciplines;

-- 2. Criar políticas ATÔMICAS e DIRETAS para a tabela disciplines
-- Política para o Professor (Dono): Direta, sem consulta a outras tabelas/funções
CREATE POLICY "disciplines_teacher_select"
ON public.disciplines
FOR SELECT
TO authenticated
USING (teacher_id = auth.uid());

-- Política para o Administrador: Usa has_role (que é SECURITY DEFINER e não recursiva)
CREATE POLICY "disciplines_admin_select"
ON public.disciplines
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Política para o Aluno Matriculado: Usa a função check_student_enrollment (SECURITY DEFINER)
-- Esta função consulta apenas discipline_students, evitando o loop.
CREATE POLICY "disciplines_student_select"
ON public.disciplines
FOR SELECT
TO authenticated
USING (public.check_student_enrollment(id, auth.uid()));

-- 3. Limpar políticas antigas na tabela discipline_students
DROP POLICY IF EXISTS "discipline_students_access_policy_fixed" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_membership_select" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_self" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_admin" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_teacher" ON public.discipline_students;

-- 4. Criar políticas para a tabela discipline_students
-- Aluno vê a própria matrícula
CREATE POLICY "discipline_students_self_select"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- Admin vê tudo
CREATE POLICY "discipline_students_admin_select"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Professor vê seus alunos
-- Importante: A subquery abaixo consulta 'disciplines', mas como o RLS de disciplines agora 
-- tem uma política direta para o professor (teacher_id = auth.uid()), não haverá recursão.
CREATE POLICY "discipline_students_teacher_select"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines d 
    WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
  )
);

-- 5. Garantir Grants
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
