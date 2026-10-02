-- CORREÇÃO CRÍTICA: QUEBRA DE RECURSÃO INFINITA NA TABELA DISCIPLINES
-- O erro 42P17 ocorre porque is_discipline_member consulta public.disciplines,
-- o que dispara o próprio RLS da disciplines novamente.

-- 1. Criar uma função específica para checar matrícula de aluno (sem tocar na tabela disciplines)
CREATE OR REPLACE FUNCTION public.check_student_enrollment(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.discipline_students
    WHERE discipline_id = _discipline_id AND student_id = _user_id
  );
$$;

-- 2. Limpar políticas problemáticas na tabela disciplines
DROP POLICY IF EXISTS "disciplines_membership_select" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_select_policy_v2" ON public.disciplines;

-- 3. Criar política DIRETA para professores e admins, e funcional para alunos
-- Ao usar teacher_id = auth.uid() diretamente, não há SELECT na tabela disciplines dentro da política.
CREATE POLICY "disciplines_access_policy_fixed"
ON public.disciplines
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() -- Professor dono (Direto, sem loop)
  OR public.has_role(auth.uid(), 'admin') -- Admin (Direto, sem loop)
  OR public.check_student_enrollment(id, auth.uid()) -- Aluno matriculado (Consulta discipline_students)
);

-- 4. Ajustar política de discipline_students para não ser recursiva também
DROP POLICY IF EXISTS "discipline_students_membership_select" ON public.discipline_students;

CREATE POLICY "discipline_students_access_policy_fixed"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  student_id = auth.uid() -- Aluno vendo a própria matrícula
  OR public.has_role(auth.uid(), 'admin') -- Admin
  OR EXISTS (
    -- Professor vendo seus alunos
    -- O RLS de disciplines agora é seguro, então esta subquery não causará loop
    SELECT 1 FROM public.disciplines d 
    WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
  )
);

-- 5. Garantir permissões
GRANT EXECUTE ON FUNCTION public.check_student_enrollment(uuid, uuid) TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
