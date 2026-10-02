-- Permitir leitura de objetos no storage para usuários autenticados
-- Isso é necessário para que os alunos consigam baixar/visualizar os arquivos enviados.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        DROP POLICY IF EXISTS "Read storage objects" ON storage.objects;
        CREATE POLICY "Read storage objects" ON storage.objects FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Garantir leitura nas tabelas que realmente existem e representam os materiais
DROP POLICY IF EXISTS "Users read module items" ON public.materials;
CREATE POLICY "Users read module items" ON public.materials FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users read modules of enrolled/owned disciplines" ON public.material_modules;
CREATE POLICY "Users read modules of enrolled/owned disciplines" ON public.material_modules FOR SELECT TO authenticated USING (true);

-- Garantir GRANTS
GRANT SELECT ON public.materials TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
