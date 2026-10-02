-- 1. LIMPEZA E LIBERAÇÃO DA TABELA PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura do próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Anyone authenticated can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow authenticated read profiles" ON public.profiles;

CREATE POLICY "Allow authenticated read profiles" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (true);

-- 2. LIMPEZA E LIBERAÇÃO DA TABELA DISCIPLINES
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professores leem suas disciplinas" ON public.disciplines;
DROP POLICY IF EXISTS "Users can view assigned disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Teachers can view own disciplines" ON public.disciplines;
DROP POLICY IF EXISTS "Allow authenticated read disciplines" ON public.disciplines;

CREATE POLICY "Allow authenticated read disciplines" 
ON public.disciplines FOR SELECT 
TO authenticated 
USING (auth.uid() = teacher_id OR teacher_id IS NULL);

-- 3. Garantir Grants
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.disciplines TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.disciplines TO anon;
