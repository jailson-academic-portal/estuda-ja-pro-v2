-- Garante que RLS esteja ativo na tabela profiles sem bloqueios de função
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas de perfis que dependiam de funções restritas
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Allow authenticated read profiles" ON profiles;
DROP POLICY IF EXISTS "allow_authenticated_read_profiles" ON profiles;

-- Cria política permissiva e direta para leitura de perfil de usuário logado
CREATE POLICY "allow_authenticated_read_profiles" 
ON profiles FOR SELECT 
TO authenticated 
USING (true);

-- Grant select on profiles to authenticated if not already granted
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
