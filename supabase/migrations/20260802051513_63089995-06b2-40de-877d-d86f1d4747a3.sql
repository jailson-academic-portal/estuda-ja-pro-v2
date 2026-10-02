-- 1. Políticas para a tabela profiles
-- Garante que cada usuário possa ler seu próprio perfil (essencial para o auth-context)
DO $$ 
BEGIN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Permitir leitura do próprio perfil" ON public.profiles;
    CREATE POLICY "Permitir leitura do próprio perfil" 
    ON public.profiles
    FOR SELECT 
    TO authenticated
    USING (auth.uid() = id);

    -- Permissão de leitura base para perfis (complementar)
    DROP POLICY IF EXISTS "Anyone authenticated can read profiles" ON public.profiles;
    CREATE POLICY "Anyone authenticated can read profiles"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (true);
END $$;

-- 2. Políticas para a tabela disciplinas (disciplines)
DO $$ 
BEGIN
    ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Professores leem suas disciplinas" ON public.disciplines;
    CREATE POLICY "Professores leem suas disciplinas" 
    ON public.disciplines
    FOR SELECT 
    TO authenticated
    USING (auth.uid() = teacher_id OR teacher_id IS NULL);

    -- Garantir permissão total para o professor dono
    DROP POLICY IF EXISTS "Teachers can manage own disciplines" ON public.disciplines;
    CREATE POLICY "Teachers can manage own disciplines"
    ON public.disciplines
    FOR ALL
    TO authenticated
    USING (teacher_id = auth.uid())
    WITH CHECK (teacher_id = auth.uid());
END $$;

-- 3. Garantir Grants finais
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
