import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

export type LessonPlanClinicalTheme = {
  modulo: number;
  modulo_titulo: string;
  tema: string;
  objetivos?: string;
  cenario?: string;
};

export type LessonPlanThemeBankPayload = {
  planId: string | null;
  planTitle: string | null;
  estudos_de_caso: string[];
  estudos_de_caso_detalhe: Array<{ modulo: number; modulo_titulo: string; tema: string }>;
  trabalho_academico: string;
  trabalho_academico_detalhe: {
    tema: string;
    tipo: string;
    objetivos: string;
    criterios: string;
    lancamento?: string;
    entrega?: string;
  } | null;
  tema_caso_clinico_simulsaude: LessonPlanClinicalTheme[];
  atividades_extras: Array<{ modulo: number; modulo_titulo: string; tipo: string; titulo: string; descricao: string }>;
};

export type LessonPlanItemKind = "case_study" | "clinical_case" | "academic_work" | "extra_activity";

export type LessonPlanItemMetadata = {
  tipo?: string;
  subtype?: string;
  objetivos?: string;
  cenario?: string;
  criterios?: string;
  lancamento?: string | null;
  entrega?: string | null;
};

export type LessonPlanItem = {
  id: string;
  kind: LessonPlanItemKind;
  title: string;
  description: string | null;
  module_number: number | null;
  module_title: string | null;
  metadata: LessonPlanItemMetadata;
  plan_generation_id: string | null;
  created_at: string;
};

const str = (v: unknown) => String(v ?? "").trim();

const EMPTY_BANK: LessonPlanThemeBankPayload = {
  planId: null,
  planTitle: null,
  estudos_de_caso: [],
  estudos_de_caso_detalhe: [],
  trabalho_academico: "",
  trabalho_academico_detalhe: null,
  tema_caso_clinico_simulsaude: [],
  atividades_extras: [],
};

/** Converte o `prompt.banco_temas_sugeridos` gravado com o plano em payload tipado. */
function parseThemeBankRow(row: { id: string; title: string | null; prompt: unknown }): LessonPlanThemeBankPayload | null {
  const bank = (row.prompt as any)?.banco_temas_sugeridos;
  if (!bank) return null;

  const estudos = Array.isArray(bank.estudos_de_caso) ? bank.estudos_de_caso.map(String).filter(Boolean) : [];
  const estudosDetalhe = Array.isArray(bank.estudos_de_caso_detalhe)
    ? bank.estudos_de_caso_detalhe
        .map((c: any) => ({ modulo: Number(c?.modulo ?? 0), modulo_titulo: str(c?.modulo_titulo), tema: str(c?.tema) }))
        .filter((c: { tema: string }) => !!c.tema)
    : estudos.map((tema: string) => ({ modulo: 0, modulo_titulo: "", tema }));

  const workRaw = bank.trabalho_academico_detalhe;
  const workDetail =
    workRaw && typeof workRaw === "object"
      ? {
          tema: str(workRaw.tema) || str(bank.trabalho_academico),
          tipo: str(workRaw.tipo),
          objetivos: str(workRaw.objetivos),
          criterios: str(workRaw.criterios),
          lancamento: str(workRaw.lancamento) || undefined,
          entrega: str(workRaw.entrega) || undefined,
        }
      : str(bank.trabalho_academico)
        ? { tema: str(bank.trabalho_academico), tipo: "", objetivos: "", criterios: "" }
        : null;

  return {
    planId: row.id,
    planTitle: row.title ?? null,
    estudos_de_caso: estudos,
    estudos_de_caso_detalhe: estudosDetalhe,
    trabalho_academico: str(bank.trabalho_academico),
    trabalho_academico_detalhe: workDetail,
    tema_caso_clinico_simulsaude: Array.isArray(bank.tema_caso_clinico_simulsaude)
      ? bank.tema_caso_clinico_simulsaude
          .map((t: any) => ({
            modulo: Number(t?.modulo ?? 0),
            modulo_titulo: str(t?.modulo_titulo),
            tema: str(t?.tema),
            objetivos: str(t?.objetivos) || undefined,
            cenario: str(t?.cenario) || undefined,
          }))
          .filter((t: { tema: string }) => !!t.tema)
      : [],
    atividades_extras: Array.isArray(bank.atividades_extras)
      ? bank.atividades_extras
          .map((a: any) => ({
            modulo: Number(a?.modulo ?? 0),
            modulo_titulo: str(a?.modulo_titulo),
            tipo: str(a?.tipo),
            titulo: str(a?.titulo),
            descricao: str(a?.descricao),
          }))
          .filter((a: { titulo: string }) => !!a.titulo)
      : [],
  };
}

/**
 * Retorna o Banco de Temas Sugeridos do Plano de Aula ativo (mais recente)
 * da disciplina — usado pelo SimulSaúde, Atividades Extras e Trabalhos.
 */
export const getLessonPlanThemeBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ disciplineId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<LessonPlanThemeBankPayload> => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: rows } = await supabaseAdmin
      .from("ai_generations")
      .select("id, title, prompt, created_at")
      .eq("discipline_id", data.disciplineId)
      .eq("tool", "lesson_plan")
      .order("created_at", { ascending: false })
      .limit(5);

    for (const row of rows ?? []) {
      const parsed = parseThemeBankRow(row);
      if (parsed) return parsed;
    }

    return EMPTY_BANK;
  });

/** Módulo do Plano de Aula ativo — teórico (com aulas) ou prático (com etapas). */
export type LessonPlanModule = {
  numero: number;
  titulo: string;
  pratico: boolean;
  /** "Aula N: Tema" das aulas teóricas do módulo. */
  aulas: string[];
  /** "Etapa N: Título" das atividades práticas do módulo. */
  etapas: string[];
};

/**
 * Extrai os módulos do markdown do Plano de Aula, incluindo módulos práticos
 * (sem tabela de aulas) — usados no seletor de módulos do SimulSaúde.
 */
function parsePlanModules(markdown: string): LessonPlanModule[] {
  const lines = String(markdown ?? "").split("\n");
  const modules: LessonPlanModule[] = [];
  let current: LessonPlanModule | null = null;
  let etapaCount = 0;

  for (const raw of lines) {
    const line = raw.trim();
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const titulo = h3[1].replace(/\*\*/g, "").trim();
      if (!/m[óo]dulo/i.test(titulo)) {
        current = null;
        continue;
      }
      const numero = Number(titulo.match(/M[óo]dulo\s*(\d+)/i)?.[1] ?? modules.length + 1);
      current = {
        numero,
        titulo,
        pratico: /pr[áa]tico|projeto integrador|avaliativo/i.test(titulo),
        aulas: [],
        etapas: [],
      };
      etapaCount = 0;
      modules.push(current);
      continue;
    }
    if (!current) continue;
    if (/^##\s+/.test(line)) {
      current = null;
      continue;
    }

    // Linha de tabela de aulas: | 1 | Tema | ... |
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (row) {
      const first = row[1].trim();
      const tema = row[2].replace(/<br\s*\/?>/gi, " ").trim();
      if (/^\d+$/.test(first)) {
        current.aulas.push(`Aula ${Number(first)}${tema && tema !== "—" ? `: ${tema}` : ""}`);
      } else if (/^etapa/i.test(first)) {
        etapaCount += 1;
        current.etapas.push(`${first}${tema && tema !== "—" ? `: ${tema}` : ""}`);
      }
      continue;
    }

    // Bullet de atividade prática: - **Tipo — Título**
    const bullet = line.match(/^-\s+\*\*(.+?)\*\*\s*$/);
    if (bullet) {
      const label = bullet[1].trim();
      if (!/^atividades pr[áa]ticas conforme/i.test(label)) {
        etapaCount += 1;
        current.etapas.push(`Etapa ${etapaCount}: ${label}`);
      }
    }
  }

  return modules
    .filter((m) => !!m.titulo)
    .sort((a, b) => a.numero - b.numero);
}

/**
 * Retorna TODOS os módulos do Plano de Aula ativo da disciplina, teóricos e
 * práticos, para o seletor "Vínculo com Módulos e Aulas".
 */
export const getLessonPlanModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ disciplineId: z.string().uuid(), planId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ planId: string | null; modules: LessonPlanModule[] }> => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    let query = supabaseAdmin
      .from("ai_generations")
      .select("id, result, created_at")
      .eq("discipline_id", data.disciplineId)
      .eq("tool", "lesson_plan");
    if (data.planId) query = query.eq("id", data.planId);

    const { data: rows } = await query.order("created_at", { ascending: false }).limit(5);

    for (const row of rows ?? []) {
      const markdown = typeof row.result === "string" ? row.result : "";
      const modules = parsePlanModules(markdown);
      if (modules.length) return { planId: row.id, modules };
    }
    return { planId: null, modules: [] };
  });

export type LessonPlanLinkedActivity = {
  id: string;
  title: string;
  instructions: string;
  subtype: string;
  status: "draft" | "published";
};

export type LessonPlanLinkedWork = {
  id: string | null;
  tema: string;
  tipo: string;
  subtype: string;
  objetivos: string;
  criterios: string;
  instructions: string;
};

export type LessonPlanLinkedItemsPayload = {
  planId: string;
  planTitle: string | null;
  bank: LessonPlanThemeBankPayload;
  /** Atividades/estudos de caso gravados em `activities` a partir deste plano. */
  activities: LessonPlanLinkedActivity[];
  /** Trabalho acadêmico previsto no plano (rascunho em `academic_works` ou dados do banco de temas). */
  work: LessonPlanLinkedWork | null;
};

/**
 * Dados de UM plano específico (escolhido no dropdown do modal de criação):
 * banco de temas + atividades e trabalho já materializados nas tabelas finais.
 */
export const getLessonPlanLinkedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ disciplineId: z.string().uuid(), planId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<LessonPlanLinkedItemsPayload> => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: planRow } = await supabaseAdmin
      .from("ai_generations")
      .select("id, title, prompt")
      .eq("id", data.planId)
      .eq("discipline_id", data.disciplineId)
      .eq("tool", "lesson_plan")
      .maybeSingle();
    if (!planRow) throw new Error("Plano de Aula não encontrado para esta disciplina.");

    const bank = parseThemeBankRow(planRow) ?? { ...EMPTY_BANK, planId: planRow.id, planTitle: planRow.title ?? null };

    const [{ data: actRows }, { data: workRows }] = await Promise.all([
      context.supabase
        .from("activities")
        .select("id, title, instructions, subtype, status, created_at")
        .eq("discipline_id", data.disciplineId)
        .eq("source_generation_id", data.planId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("academic_works")
        .select("id, title, instructions, subtype, status, created_at")
        .eq("discipline_id", data.disciplineId)
        .eq("source_generation_id", data.planId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const activities: LessonPlanLinkedActivity[] = (actRows ?? []).map((a: any) => ({
      id: a.id,
      title: str(a.title),
      instructions: str(a.instructions),
      subtype: str(a.subtype) || "free_activity",
      status: a.status === "published" ? "published" : "draft",
    }));

    const { mapAcademicWorkSubtype } = await import("./generators/lesson-plan-sync.server");
    const detail = bank.trabalho_academico_detalhe;
    const workRow = workRows?.[0] as any | undefined;
    let work: LessonPlanLinkedWork | null = null;
    if (detail?.tema || workRow) {
      const tema = detail?.tema || str(workRow?.title);
      const tipo = detail?.tipo ?? "";
      const parts: string[] = [];
      if (tipo) parts.push(`Tipo de trabalho: ${tipo}`);
      if (detail?.objetivos) parts.push(`Objetivos específicos: ${detail.objetivos}`);
      if (detail?.criterios) parts.push(`Critérios de avaliação: ${detail.criterios}`);
      work = {
        id: workRow?.id ?? null,
        tema,
        tipo,
        subtype: str(workRow?.subtype) || mapAcademicWorkSubtype(tipo),
        objetivos: detail?.objetivos ?? "",
        criterios: detail?.criterios ?? "",
        instructions: str(workRow?.instructions) || parts.join("\n"),
      };
    }

    return { planId: planRow.id, planTitle: planRow.title ?? null, bank, activities, work };
  });

/**
 * Lista os itens estruturados sincronizados a partir do Plano de Aula ativo
 * (estudos de caso, casos clínicos, trabalho acadêmico, atividades extras).
 * Leitura via RLS: professor, admin e alunos matriculados na disciplina.
 */
export const getLessonPlanItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        disciplineId: z.string().uuid(),
        kind: z.enum(["case_study", "clinical_case", "academic_work", "extra_activity"]).optional(),
        kinds: z.array(z.enum(["case_study", "clinical_case", "academic_work", "extra_activity"])).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<LessonPlanItem[]> => {
    let query = context.supabase
      .from("lesson_plan_items")
      .select("id, kind, title, description, module_number, module_title, metadata, plan_generation_id, created_at")
      .eq("discipline_id", data.disciplineId)
      .order("module_number", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    const kinds = data.kinds?.length ? data.kinds : data.kind ? [data.kind] : null;
    if (kinds) query = query.in("kind", kinds);

    const { data: rows, error } = await query;
    if (error) {
      console.error("[getLessonPlanItems]", error.message);
      return [];
    }
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      kind: r.kind as LessonPlanItemKind,
      title: String(r.title ?? ""),
      description: r.description ?? null,
      module_number: r.module_number ?? null,
      module_title: r.module_title ?? null,
      metadata: (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as LessonPlanItemMetadata,
      plan_generation_id: r.plan_generation_id ?? null,
      created_at: r.created_at,
    }));
  });
