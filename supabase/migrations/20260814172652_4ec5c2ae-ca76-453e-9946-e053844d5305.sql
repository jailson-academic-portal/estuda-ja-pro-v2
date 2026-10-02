-- RESTAURAR ACESSO DO ALUNO VIA SERVER FUNCTION (SECURITY DEFINER)
-- O erro 42P17 (recursão infinita) acontece quando o RLS tenta validar o acesso 
-- à 'disciplines' consultando 'discipline_students', que por sua vez tem um RLS 
-- que consulta 'disciplines'.

-- 1. Criar a função Security Definer que será a fonte da verdade para o RLS
-- Esta função ignora o RLS das tabelas consultadas.
CREATE OR REPLACE FUNCTION public.is_discipline_member(_discipline_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Acesso como professor
    SELECT 1 FROM public.disciplines WHERE id = _discipline_id AND teacher_id = _user_id
    UNION ALL
    -- Acesso como aluno
    SELECT 1 FROM public.discipline_students WHERE discipline_id = _discipline_id AND student_id = _user_id
    UNION ALL
    -- Acesso como admin
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  );
$$;

-- 2. Limpar políticas recursivas
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disciplines_select_policy" ON public.disciplines;
DROP POLICY IF EXISTS "Students can see enrolled disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers can manage their own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Admins can see everything" ON public.disciplines;
DROP POLICY IF EXISTS "authenticated_view_disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "disciplines_secure_base" ON public.disciplines;

-- 3. Aplicar nova política NÃO-RECURSIVA para Disciplinas
CREATE POLICY "disciplines_membership_select"
ON public.disciplines
FOR SELECT
TO authenticated
USING (public.is_discipline_member(id, auth.uid()));

-- 4. Limpar políticas recursivas de Matrículas
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discipline_students_select_policy" ON public.discipline_students;
DROP POLICY IF EXISTS "Students can see their own enrollments" ON public.discipline_students;
DROP POLICY IF EXISTS "authenticated_view_enrollments" ON public.discipline_students;
DROP POLICY IF EXISTS "discipline_students_secure_base" ON public.discipline_students;

-- 5. Aplicar nova política NÃO-RECURSIVA para Matrículas
-- Nota: Aqui usamos auth.uid() direto para o aluno e consultamos a tabela pai
-- APENAS se o professor for o dono, mas sem join recursivo.
CREATE POLICY "discipline_students_membership_select"
ON public.discipline_students
FOR SELECT
TO authenticated
USING (
  student_id = auth.uid() 
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    -- Esta subquery consulta 'disciplines', mas o RLS de 'disciplines'
    -- agora usa a função SECURITY DEFINER, quebrando o loop.
    SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()
  )
);

-- 6. Garantir permissões de execução
GRANT EXECUTE ON FUNCTION public.is_discipline_member(uuid, uuid) TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.discipline_students TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
