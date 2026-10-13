# EstudaJá Pro - Versão 2

## Status do Projeto

**ATENÇÃO: Esta é a VERSÃO 2 do projeto, uma cópia de trabalho (working copy). Todo o desenvolvimento continuará nesta versão.**

## Histórico das Versões

| Versão | Status | Backend | Descrição |
|--------|--------|---------|-----------|
| **Versão 1** | Original | Lovable Cloud | Versão em produção com Supabase integrado via Lovable |
| **Versão 2** | **Cópia de Trabalho** | **Preparatória para Supabase** | Desenvolvimento ativo, preparando implementação nativa do Supabase |

## Objetivo da Versão 2

A **Versão 2** tem como objetivo ser uma **etapa preparatória para implementação do Supabase**:

1. **Remover dependência do Lovable Cloud** - Migrar código para desenvolvimento local
2. **Preparar estrutura para Supabase nativo** - Configurar cliente Supabase diretamente
3. **Manter funcionalidades existentes** - Garantir que todas as features da V1 continuem funcionando
4. **Codebase limpa** - Remover arquivos e configurações específicas do Lovable

## Tecnologias

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend/DB**: Supabase (`iybaqzddxnbghfrpfpgm`)
- **IA**: OpenAI API (mantida)
- **Hospedagem**: Local / Vercel / Netlify (futuro)

## Perfis de Usuário

- **Admin**: Superusuário com acesso total
- **Institution**: Gestão institucional
- **Teacher**: Professor com disciplinas próprias
- **Student**: Aluno via matrícula

## Entidade Central

A **Disciplina** é a entidade central do sistema. Todos os recursos (materiais, atividades, exercícios, presença, notas, avaliações) pertencem a uma disciplina.

## Diretrizes de Desenvolvimento

1. Priorizar desenvolvimento **local** (sem Lovable)
2. Configurar Supabase **manualmente**
3. Manter **compatibilidade** com dados da V1
4. Documentar mudanças significativas
5. Commits claros e descritivos

## ⚡ Eficiência de Contexto

**REGRA: Sempre usar contexto compacto para economizar tokens**

- Preferir **resumos** em vez de dumps de código completos
- Responder com conclusões, não com o processo de busca
- Pedidos de leitura de arquivos: indicar **apenas as linhas/funções específicas** necessárias
- Ao buscar código: especificar escopo (arquivo X, função Y, linha Z)
- Commits: resumos curtos e diretos

**Why:** Reduzir custos de tokens sem perder qualidade de assistance.

**How to apply:** Antes de cada resposta, avaliar se o contexto pode ser condensado. Usar "resumir", "linhas 10-20", "apenas a função X" quando possível.

## Estrutura de Diretórios

```
EstudaJá Pro Versão 2/
├── src/                    # Código fonte principal
├── public/                 # Arquivos públicos
├── drizzle/                # Migrações do banco
├── .lovable/              # Histórico do Lovable (legacy)
├── remotion/              # Módulo removido
├── graphify-out/          # Análise de código
├── mem/                   # Memórias do projeto
└── CLAUDE.md              # Este arquivo
```

## Referências

- **Versão 1 (Original)**: `C:\Users\USER\OneDrive\Area de Trabalho\EstudaJá Pro Versão 1`
- **Live App V1**: https://owl-learn-hub.lovable.app
- **Lovable Project**: https://lovable.dev/projects/964fdf5e-4160-44e0-8d98-8a046c2832cc
