-- 1. Permissão de leitura base para perfis (profiles)
-- Garante que qualquer usuário autenticado consiga ler seu próprio perfil e papéis básicos
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'profiles' AND policyname = 'Anyone authenticated can read profiles'
    ) THEN
        CREATE POLICY "Anyone authenticated can read profiles"
        ON public.profiles
        FOR SELECT
        TO authenticated
        USING (true);
    END IF;
END $$;

-- 2. Ajuste de RLS em disciplinas
-- Permite que professores vejam suas próprias disciplinas (teacher_id)
DO $$ 
BEGIN
    -- Política de leitura para disciplinas
    DROP POLICY IF EXISTS "Teachers can view own disciplines" ON public.disciplines;
    CREATE POLICY "Teachers can view own disciplines"
    ON public.disciplines
    FOR SELECT
    TO authenticated
    USING (teacher_id = auth.uid());

    -- Política de escrita para professores (donos)
    DROP POLICY IF EXISTS "Teachers can manage own disciplines" ON public.disciplines;
    CREATE POLICY "Teachers can manage own disciplines"
    ON public.disciplines
    FOR ALL
    TO authenticated
    USING (teacher_id = auth.uid())
    WITH CHECK (teacher_id = auth.uid());
END $$;

-- 3. Ajuste de RLS em módulos (material_modules)
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Teachers can manage own modules" ON public.material_modules;
    CREATE POLICY "Teachers can manage own modules"
    ON public.material_modules
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.disciplines d 
            WHERE d.id = material_modules.discipline_id 
            AND d.teacher_id = auth.uid()
        )
    );
END $$;

-- 4. Garantir Grants
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
