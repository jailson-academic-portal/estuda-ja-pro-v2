# Plano de Configuração dos Acessos - EstudaJá Pro V2

## Resumo

Este documento descreve como configurar os três tipos de acesso no EstudaJá Pro V2:
1. **Admin + Professor Pro**: jailsonresende@gmail.com
2. **Professores**: email/senha (sem privilégios admin)
3. **Estudantes**: matrícula (acesso restrito)

---

## A. Migration de Promoção (Supabase)

### Arquivo: `supabase/migrations/20261012120000_promote_jailson_admin_teacher.sql`

```sql
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

  -- 1) Garantir profile_type = 'admin'
  UPDATE public.profiles
  SET profile_type = 'admin'
  WHERE id = v_user_id;

  -- 2) Inserir papel admin (idempotente)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 3) Inserir papel teacher (idempotente)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'teacher')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
```

### Aplicar ao Supabase V2

```bash
npx supabase db push
```

---

## B. Fluxos de Acesso (Frontend - já implementado)

### 1. Admin + Professor Pro (jailsonresende@gmail.com)

**Login:** Email/senha via `signInWithPassword`

**Mecanismo:**
- `profile_type = 'admin'` → Dashboard Admin por padrão
- `viewAs = 'teacher'` → Alterna para Dashboard Professor
- `teacher_has_paid_plan()` retorna `true` via `has_role('admin')`

**Arquivos:**
- `src/routes/index.tsx:84`: `{effectiveProfileType === "admin" && <AdminDashboard />}`
- `src/lib/auth-context.tsx:230-231`: Lógica de alternância viewAs
- `src/components/AppHeader.tsx:33`: `viewAs` controls

### 2. Demais Professores

**Login:** Email/senha via `signInWithPassword`

**Mecanismo:**
- `profile_type = 'teacher'` → Dashboard Professor
- Não há botão viewAs (só admins têm)
- Não são Pro por padrão (a menos que tengan subscription)

**Arquivos:**
- `src/routes/login.tsx:252`: `supabase.auth.signInWithPassword`
- `src/routes/index.tsx:86`: `{effectiveProfileType === "teacher" && <TeacherDashboard />}`

### 3. Estudantes

**Login:** Matrícula via `studentMatriculaLogin`

**Mecanismo:**
- `student-login.functions.ts:71`: Verifica `profile_type === 'student'`
- Cria usuário em `students.estudaja.local`
- Não pode usar login email/senha

**Arquivos:**
- `src/routes/login.tsx:364`: `studentMatriculaLogin`
- `src/backend/student-login.functions.ts`: Função server-side
- `src/routes/index.tsx:87`: `{effectiveProfileType === "student" && <StudentDashboard />}`

---

## C. Segurança

| Verificação | Implementação |
|------------|---------------|
| Busca case-insensitive | `lower(email) = lower(v_email_addr)` |
| Fail-fast count=0 | `RAISE EXCEPTION` |
| Fail-fast count>1 | `RAISE EXCEPTION` |
| Verificação perfil | `IF NOT EXISTS (SELECT 1 FROM profiles...)` |
| UPDATE só jailson | `WHERE id = v_user_id` |
| Idempotência | `ON CONFLICT (user_id, role) DO NOTHING` |
| Bloqueio matrícula | `profile_type !== 'student'` |
| Alternância Admin/Teacher | `viewAs` + `effectiveProfileType` |

---

## D. Passos para Publicar no Lovable

### 1. Preparar o ambiente local

```bash
# Verificar status
git status

# Criar branch para a mudança
git checkout -b feature/admin-promotion
```

### 2. Commit local (opcional - não fazer push)

```bash
git add supabase/migrations/20261012120000_promote_jailson_admin_teacher.sql
git commit -m "Promove jailson para admin + professor Pro"
```

### 3. Exportar/Sincronizar com Lovable

O Lovable sincroniza automaticamente quando você faz push para o repositório conectado. Se não houver conexão Git:

1. Acessar o projeto no Lovable
2. Exportar/Copiar os arquivos modificados
3. Fazer upload manual

---

## E. Configuração do Supabase (Lovable)

O Lovable usa variáveis de ambiente para连接到 Supabase:

| Variável | Valor |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://iybaqzddxnbghfrpfpgm.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJhbGci...` (ver `.env`) |

Essas variáveis devem estar configuradas no dashboard do Lovable para que o frontend se conecte ao Supabase V2 correto.

---

## F. Testes Manuais

### Teste 1: Login Admin + Alternância
1. Acessar `/login`
2. Aba "Professor" → jailsonresende@gmail.com + senha
3. Verificar Dashboard Admin aparece
4. Clicar "Visão de Professor" no header
5. Verificar Dashboard Professor aparece
6. Verificar badge "Pro" aparece

### Teste 2: Login Professor (outro)
1. Acessar `/login`
2. Aba "Professor" → email/senha de professor
3. Verificar Dashboard Professor aparece (não Admin)
4. Verificar: NÃO há botão "Visão de Professor"

### Teste 3: Login Estudante
1. Acessar `/login`
2. Aba "Aluno" → matrícula
3. Verificar Dashboard Estudante aparece
4. Tentar usar email/senha → "Usuário não encontrado"
5. Tentar login matrícula como professor → "Usuário não encontrado"

---

## G. Checklist de Verificação

- [ ] Migration criada: `20261012120000_promote_jailson_admin_teacher.sql`
- [ ] Migration aplicada ao Supabase V2
- [ ] Código sincronizado com Lovable
- [ ] Variáveis de ambiente configuradas no Lovable
- [ ] Teste 1: Login Admin + alternância ✅
- [ ] Teste 2: Login Professor (outro) ✅
- [ ] Teste 3: Login Estudante ✅

---

## H. Solução de Problemas

### "Usuário não encontrado" após aplicar migration
- Verificar se o email está correto em `auth.users`
- Verificar se o perfil existe em `public.profiles`
- Executar `SELECT * FROM auth.users WHERE lower(email) = 'jailsonresende@gmail.com'`

### Dashboard Admin não aparece
- Verificar `profile_type = 'admin'` em `public.profiles`
- Verificar `has_role(user_id, 'admin')` em `public.user_roles`

### Botão "Visão de Professor" não aparece
- Apenas admins têm esse botão
- Verificar `profile_type = 'admin'`

### Estudante consegue ver área de professor
- Verificar `studentMatriculaLogin` rejeita não-estudantes
- Verificar RLS em `public.profiles`
