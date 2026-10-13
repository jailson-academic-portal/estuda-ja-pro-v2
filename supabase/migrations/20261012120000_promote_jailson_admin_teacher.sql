-- =============================================================================
-- PROMOVE JAILSON PARA ADMIN + PROFESSOR PRO
-- =============================================================================
-- E-mail: jailsonresende@gmail.com
--
-- Alterações:
--   1. Garante profile_type = 'admin' em profiles
--   2. Insere papel 'admin' em user_roles (idempotente)
--   3. Insere papel 'teacher' em user_roles (idempotente)
--
-- Segurança:
--   - Busca por email (não por UUID fixo)
--   - Falha com mensagem clara se usuário não existir
--   - UNIQUE constraint impede duplicatas em user_roles
-- =============================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_email_addr text := 'jailsonresende@gmail.com';
  v_email_count integer;
BEGIN
  -- Validação: usuário existe?
  SELECT COUNT(*) INTO v_email_count
  FROM auth.users
  WHERE lower(email) = lower(v_email_addr);

  IF v_email_count = 0 THEN
    RAISE EXCEPTION 'ERRO: Nenhum usuário encontrado com e-mail %', v_email_addr;
  END IF;

  IF v_email_count > 1 THEN
    RAISE EXCEPTION 'ERRO: % usuários encontrados com e-mail % (esperado: 1). Dados duplicados no auth.users.', v_email_count, v_email_addr;
  END IF;

  -- Obter ID do usuário
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email_addr);

  -- Validar que o perfil existe
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'ERRO: Perfil não encontrado para usuario %', v_user_id;
  END IF;

  RAISE NOTICE '=== PROMOCAO DE ACESSO ===';
  RAISE NOTICE 'Usuario: % (%)', v_email_addr, v_user_id;

  -- 1) Garantir profile_type = 'admin'
  UPDATE public.profiles
  SET profile_type = 'admin'
  WHERE id = v_user_id;

  RAISE NOTICE '[OK] profiles.profile_type = admin';

  -- 2) Inserir papel admin (idempotente)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE '[OK] user_roles: papel admin inserido (ou ja existia)';

  -- 3) Inserir papel teacher (idempotente)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'teacher')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE '[OK] user_roles: papel teacher inserido (ou ja existia)';

  -- 4) Resumo final
  RAISE NOTICE '=== ESTADO FINAL ===';
  RAISE NOTICE 'profiles.profile_type: %', (SELECT profile_type FROM profiles WHERE id = v_user_id);
  RAISE NOTICE 'user_roles: %', (SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = v_user_id);

END $$;
