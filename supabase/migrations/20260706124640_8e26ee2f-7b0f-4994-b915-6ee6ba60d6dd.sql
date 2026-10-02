-- Item 1 (crítico): instituições não devem ler linhas de alunos diretamente (expunha e-mail).
-- Leitura do painel passa a ser feita por server function com service role, escopada.
DROP POLICY IF EXISTS "Institutions see profiles in their institution" ON public.profiles;

-- Item 5: bucket público 'branding' permitia LISTAR todos os arquivos via API.
-- Logos são servidas por URL pública (não exigem esta policy), então removê-la
-- impede a enumeração sem quebrar a exibição das logos.
DROP POLICY IF EXISTS "branding public read" ON storage.objects;