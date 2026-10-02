# Plano de Otimização e Resiliência (EstudaJá Pro)

Este plano visa resolver os problemas de "loading infinito" relatados em conexões instáveis, otimizar o tamanho do carregamento inicial através de code splitting agressivo e implementar mecanismos de segurança (timeouts) para garantir que a aplicação nunca trave sem feedback.

## 1. Code Splitting & Lazy Loading (Carregamento sob Demanda)

Otimizaremos as rotas principais para que o código do painel de controle (que é pesado) só seja baixado após o login.

- **`src/router.tsx`**: Refatorar o roteador para carregar as páginas principais (Index, Início, Login, Signup, Branding, Billing, Invitations) usando `lazy`.
- **`src/routes/__root.tsx`**: Garantir que o `Suspense` global envolva o `Outlet` com um fallback visual de Skeleton.
- **Dashboards**: Transformar os dashboards (`AdminDashboard`, `InstitutionDashboard`, `TeacherDashboard`, `StudentDashboard`) em componentes lazy no ponto de consumo em `src/routes/index.tsx`.

## 2. Timeouts & Resiliência no Auth Provider

Implementaremos limites de tempo estritos na verificação inicial da sessão e busca do perfil.

- **`src/lib/auth-context.tsx`**: 
    - Adicionar um timeout de 8 segundos para a promessa de `getSession`.
    - Adicionar um timeout de 8 segundos para o carregamento do perfil.
    - Se qualquer um desses expirar ou falhar repetidamente, definir `loading: false` e permitir que a aplicação renderize o estado de erro amigável em vez de ficar em branco.
    - Implementar lógica de retry manual com botão "Tentar Novamente".

## 3. Otimização do TanStack Query (React Query)

Ajustaremos as configurações globais de rede para evitar esperas intermináveis em caso de falha.

- **`src/routes/__root.tsx`**: 
    - Configurar `retry: 1` ou `retry: 2` (reduzindo do padrão de 3 com backoff longo).
    - Aumentar `staleTime` para 5 minutos globalmente para minimizar requisições redundantes.
    - Configurar `networkMode: 'always'` ou garantir tratamentos de erro adequados para offline.

## 4. UI Fallback (Skeletons Progressivos)

Substituiremos spinners de tela cheia por Skeletons que dão feedback visual imediato sobre a estrutura da página.

- **`src/routes/index.tsx`**: Substituir o `Loader2` de tela cheia por um layout de Skeleton que espelha o dashboard do usuário.
- **`src/components/DisciplinesManager.tsx`** e **`src/components/dashboards/StudentDashboard.tsx`**: Implementar Skeletons para a grade de disciplinas.
- **`src/components/discipline/AssessmentsModule.tsx`**: Implementar Skeletons para a lista de avaliações.
- **`src/routes/login.tsx`**: Garantir que o botão de login use um feedback de loading discreto que não bloqueie a interface inteira.

## Invariante de Segurança
O aplicativo nunca deve exceder 10 segundos de carregamento sem mostrar um erro ou opção de recarregamento.

---

### Detalhes Técnicos

- Uso de `React.lazy(() => import(...))` e `Suspense`.
- Implementação de `Promise.race` com `setTimeout` no Auth Provider.
- Criação de componentes `DashboardSkeleton` específicos por papel de usuário.
- Revisão de middlewares do TanStack Start para não bloquear o SSR em falhas de bearer token.
