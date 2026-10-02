import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { LessonPlanThemeBank } from "./lesson-plan.server";
import { sanitizeAITitle } from "@/lib/text-sanitize";

export type LessonPlanItemKind = "case_study" | "clinical_case" | "academic_work" | "extra_activity";

export type LessonPlanSyncSummary = {
  items: number;
  case_studies: number;
  clinical_cases: number;
  extra_activities: number;
  /** Rascunhos realmente gravados em `activities` (estudos de caso + atividades extras). */
  activities_created: number;
  /** Rascunhos realmente gravados em `clinical_cases`. */
  clinical_cases_created: number;
  academic_work: "created" | "updated" | "kept" | "none";
  academic_work_id: string | null;
};

/** Mapeia o tipo textual do trabalho (vindo do plano) para o enum de subtipo. */
export function mapAcademicWorkSubtype(tipo: string): string {
  const t = String(tipo ?? "").toLowerCase();
  if (/tcc|conclus[ãa]o de curso|monografia/.test(t)) return "tcc";
  if (/artigo/.test(t)) return "artigo_cientifico";
  if (/revis[ãa]o/.test(t)) return "revisao_literatura";
  if (/estudo de caso|projeto de caso/.test(t)) return "estudo_caso_academico";
  if (/interven[çc][ãa]o/.test(t)) return "projeto_intervencao";
  if (/relat[óo]rio/.test(t)) return "relatorio_pesquisa";
  if (/resumo/.test(t)) return "resumo_expandido";
  if (/p[ôo]ster|poster|banner/.test(t)) return "poster_cientifico";
  return "tema_predefinido";
}

/** Mapeia o tipo textual da atividade extra para o enum `activity_subtype`. */
export function mapExtraActivitySubtype(tipo: string): string {
  const t = String(tipo ?? "").toLowerCase();
  if (/semin[áa]rio|semin[áa]rios|apresenta[çc][ãa]o/.test(t)) return "seminario";
  if (/debate|mesa[- ]redonda/.test(t)) return "debate";
  if (/visita/.test(t)) return "visita_tecnica";
  if (/aulas?\s*pr[áa]tica|laborat[óo]rio/.test(t)) return "aula_pratica";
  if (/workshop|oficina/.test(t)) return "workshop";
  if (/estudo de caso|caso/.test(t)) return "case_study";
  if (/relat[óo]rio/.test(t)) return "practical_report";
  if (/reda[çc][ãa]o|ensaio/.test(t)) return "redacao";
  return "free_activity";
}

function buildWorkInstructions(work: NonNullable<LessonPlanThemeBank["trabalho_academico_detalhe"]>): string {
  const parts: string[] = [];
  parts.push(`Tema central: ${work.tema}`);
  if (work.tipo) parts.push(`Tipo de trabalho: ${work.tipo}`);
  if (work.objetivos) parts.push(`Objetivos específicos: ${work.objetivos}`);
  if (work.criterios) parts.push(`Critérios de avaliação: ${work.criterios}`);
  if (work.lancamento && !/a definir/i.test(work.lancamento)) parts.push(`Lançamento previsto: ${work.lancamento}`);
  if (work.entrega && !/a definir/i.test(work.entrega)) parts.push(`Entrega prevista: ${work.entrega}`);
  return parts.join("\n");
}

function moduleLabel(n: number | null | undefined, title?: string | null): string {
  if (!n) return "";
  return title && !/^m[óo]dulo\s*\d+\s*$/i.test(title) ? title : `Módulo ${n}`;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Sincroniza os blocos estruturados do Plano de Aula com as tabelas relacionais.
 *
 * - `lesson_plan_items`: substitui as sugestões da disciplina pelas do plano atual.
 * - `activities`: grava RASCUNHOS (estudos de caso + atividades extras) vinculados
 *   ao plano; rascunhos de planos anteriores da disciplina são substituídos,
 *   atividades já publicadas ou criadas manualmente nunca são tocadas.
 * - `clinical_cases`: grava RASCUNHOS com título, cenário, objetivos e módulo,
 *   prontos para o professor gerar o caso completo no SimulSaúde. Casos
 *   publicados nunca são alterados.
 * - `academic_works`: cria/atualiza um RASCUNHO do trabalho semestral vinculado ao
 *   plano (nunca altera trabalho já publicado; nunca cria duplicata).
 */
export async function syncLessonPlanItems(params: {
  disciplineId: string;
  generationId: string;
  userId: string;
  themeBank: LessonPlanThemeBank;
}): Promise<LessonPlanSyncSummary> {
  const { disciplineId, generationId, userId, themeBank } = params;
  const summary: LessonPlanSyncSummary = {
    items: 0,
    case_studies: 0,
    clinical_cases: 0,
    extra_activities: 0,
    activities_created: 0,
    clinical_cases_created: 0,
    academic_work: "none",
    academic_work_id: null,
  };

  type Row = {
    discipline_id: string;
    plan_generation_id: string;
    kind: LessonPlanItemKind;
    title: string;
    description: string | null;
    module_number: number | null;
    module_title: string | null;
    metadata: Record<string, unknown>;
    created_by: string;
  };
  const rows: Row[] = [];
  const base = { discipline_id: disciplineId, plan_generation_id: generationId, created_by: userId };

  for (const c of themeBank.estudos_de_caso_detalhe) {
    rows.push({
      ...base,
      kind: "case_study",
      title: c.tema.slice(0, 300),
      description: null,
      module_number: c.modulo || null,
      module_title: c.modulo_titulo || null,
      metadata: {},
    });
    summary.case_studies++;
  }

  for (const c of themeBank.tema_caso_clinico_simulsaude) {
    rows.push({
      ...base,
      kind: "clinical_case",
      title: c.tema.slice(0, 300),
      description: [c.cenario && `Cenário: ${c.cenario}`, c.objetivos && `Objetivos: ${c.objetivos}`]
        .filter(Boolean)
        .join("\n") || null,
      module_number: c.modulo || null,
      module_title: c.modulo_titulo || null,
      metadata: { objetivos: c.objetivos ?? "", cenario: c.cenario ?? "" },
    });
    summary.clinical_cases++;
  }

  for (const a of themeBank.atividades_extras) {
    rows.push({
      ...base,
      kind: "extra_activity",
      title: a.titulo.slice(0, 300),
      description: a.descricao || null,
      module_number: a.modulo || null,
      module_title: a.modulo_titulo || null,
      metadata: { tipo: a.tipo },
    });
    summary.extra_activities++;
  }

  const work = themeBank.trabalho_academico_detalhe;
  if (work?.tema) {
    rows.push({
      ...base,
      kind: "academic_work",
      title: work.tema.slice(0, 300),
      description: buildWorkInstructions(work),
      module_number: null,
      module_title: null,
      metadata: {
        tipo: work.tipo,
        subtype: mapAcademicWorkSubtype(work.tipo),
        objetivos: work.objetivos,
        criterios: work.criterios,
        lancamento: work.lancamento ?? null,
        entrega: work.entrega ?? null,
      },
    });
  }

  // Substitui as sugestões da disciplina pelas do plano mais recente.
  const { error: delError } = await supabaseAdmin.from("lesson_plan_items").delete().eq("discipline_id", disciplineId);
  if (delError) console.error("[lesson-plan-sync] delete items:", delError.message);

  if (rows.length) {
    const { error: insError } = await supabaseAdmin.from("lesson_plan_items").insert(rows as never[]);
    if (insError) console.error("[lesson-plan-sync] insert items:", insError.message);
    else summary.items = rows.length;
  }

  // IDs de todos os planos já gerados para esta disciplina (para limpar rascunhos antigos).
  let planIds: string[] = [generationId];
  try {
    const { data: planGens } = await supabaseAdmin
      .from("ai_generations")
      .select("id")
      .eq("discipline_id", disciplineId)
      .eq("tool", "lesson_plan");
    planIds = Array.from(new Set([...(planGens ?? []).map((g) => g.id), generationId]));
  } catch (err) {
    console.error("[lesson-plan-sync] load plan ids failed:", err);
  }

  /* ------------------------------------------------------------------------
   * Atividades Extras: estudos de caso + atividades complementares → `activities`
   * ---------------------------------------------------------------------- */
  try {
    // Remove rascunhos gerados por planos anteriores (nunca publicados/manuais).
    const { error: delActErr } = await supabaseAdmin
      .from("activities")
      .delete()
      .eq("discipline_id", disciplineId)
      .eq("status", "draft")
      .in("source_generation_id", planIds);
    if (delActErr) console.error("[lesson-plan-sync] delete plan activities:", delActErr.message);

    // Títulos já existentes (publicados ou manuais) — evita duplicar.
    const { data: existingActs } = await supabaseAdmin
      .from("activities")
      .select("title")
      .eq("discipline_id", disciplineId);
    const existingTitles = new Set((existingActs ?? []).map((a) => norm(String(a.title ?? ""))));

    type ActivityRow = {
      discipline_id: string;
      subtype: string;
      title: string;
      instructions: string;
      status: "draft";
      created_by: string;
      source_generation_id: string;
      rubric: unknown[];
      grading_formula: string;
      delivery_type: string;
    };
    const activityRows: ActivityRow[] = [];
    const seen = new Set<string>();
    const pushActivity = (subtype: string, title: string, instructions: string) => {
      const t = title.trim().slice(0, 300);
      if (!t) return;
      const key = norm(t);
      if (seen.has(key) || existingTitles.has(key)) return;
      seen.add(key);
      activityRows.push({
        discipline_id: disciplineId,
        subtype,
        title: t,
        instructions,
        status: "draft",
        created_by: userId,
        source_generation_id: generationId,
        rubric: [],
        grading_formula: "weighted_average",
        delivery_type: "individual",
      });
    };

    for (const c of themeBank.estudos_de_caso_detalhe) {
      const mod = moduleLabel(c.modulo, c.modulo_titulo);
      pushActivity(
        "case_study",
        c.tema,
        [
          `Estudo de caso clínico/laboratorial previsto no Plano de Aula${mod ? ` — ${mod}` : ""}.`,
          `Tema: ${c.tema}`,
          "Analise o caso apresentado em sala, levante hipóteses diagnósticas, justifique a interpretação dos achados e proponha a conduta adequada com base no conteúdo do módulo.",
        ].join("\n\n"),
      );
    }

    for (const a of themeBank.atividades_extras) {
      const mod = moduleLabel(a.modulo, a.modulo_titulo);
      pushActivity(
        mapExtraActivitySubtype(a.tipo),
        a.titulo,
        [
          `${a.tipo || "Atividade complementar"} prevista no Plano de Aula${mod ? ` — ${mod}` : ""}.`,
          a.descricao?.trim() || "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    if (activityRows.length) {
      const { data, error } = await supabaseAdmin
        .from("activities")
        .insert(activityRows as never[])
        .select("id");
      if (error) console.error("[lesson-plan-sync] insert activities:", error.message);
      else summary.activities_created = data?.length ?? 0;
    }
  } catch (err) {
    console.error("[lesson-plan-sync] activities sync failed:", err);
  }

  /* ------------------------------------------------------------------------
   * SimulClínica: casos clínicos → `clinical_cases` (rascunhos)
   * ---------------------------------------------------------------------- */
  try {
    const { error: delCaseErr } = await supabaseAdmin
      .from("clinical_cases")
      .delete()
      .eq("discipline_id", disciplineId)
      .eq("status", "draft")
      .in("source_generation_id", planIds);
    if (delCaseErr) console.error("[lesson-plan-sync] delete plan clinical cases:", delCaseErr.message);

    const { data: existingCases } = await supabaseAdmin
      .from("clinical_cases")
      .select("title")
      .eq("discipline_id", disciplineId);
    const existingCaseTitles = new Set((existingCases ?? []).map((c) => norm(String(c.title ?? ""))));

    const caseRows = themeBank.tema_caso_clinico_simulsaude
      // O título precisa ser um nome clínico direto: descarta frases conversacionais
      // da IA ("Aqui estão 5 temas curtos e criativos...") e metadados.
      .map((c) => ({ ...c, tema: sanitizeAITitle(c.tema, 300) }))
      .filter((c) => c.tema && !existingCaseTitles.has(norm(c.tema)))
      .map((c) => ({
        discipline_id: disciplineId,
        teacher_id: userId,
        title: c.tema,
        description: [c.cenario && `Cenário: ${c.cenario}`, c.objetivos && `Objetivos: ${c.objetivos}`]
          .filter(Boolean)
          .join("\n") || `Caso clínico previsto no Plano de Aula${moduleLabel(c.modulo, c.modulo_titulo) ? ` — ${moduleLabel(c.modulo, c.modulo_titulo)}` : ""}.`,
        scenario: c.cenario?.trim() || null,
        objectives: c.objetivos?.trim() || null,
        module_number: c.modulo || null,
        source_generation_id: generationId,
        status: "draft" as const,
        patient_info: {},
        investigation_data: {},
        decision_tree: {},
      }));

    if (caseRows.length) {
      const { data, error } = await supabaseAdmin
        .from("clinical_cases")
        .insert(caseRows as never[])
        .select("id");
      if (error) console.error("[lesson-plan-sync] insert clinical cases:", error.message);
      else summary.clinical_cases_created = data?.length ?? 0;
    }
  } catch (err) {
    console.error("[lesson-plan-sync] clinical cases sync failed:", err);
  }

  /* ------------------------------------------------------------------------
   * Trabalho acadêmico: cria/atualiza rascunho vinculado ao plano.
   * ---------------------------------------------------------------------- */
  if (work?.tema) {
    try {
      const { data: linked } = await supabaseAdmin
        .from("academic_works")
        .select("id, status")
        .eq("discipline_id", disciplineId)
        .in("source_generation_id", planIds)
        .order("created_at", { ascending: false })
        .limit(1);

      const existing = linked?.[0];
      const payload = {
        title: work.tema.slice(0, 300),
        instructions: buildWorkInstructions(work),
        subtype: mapAcademicWorkSubtype(work.tipo),
        source_generation_id: generationId,
      };

      if (existing && existing.status === "published") {
        summary.academic_work = "kept";
        summary.academic_work_id = existing.id;
      } else if (existing) {
        const { error } = await supabaseAdmin.from("academic_works").update(payload as never).eq("id", existing.id);
        if (!error) {
          summary.academic_work = "updated";
          summary.academic_work_id = existing.id;
        }
      } else {
        const { data, error } = await supabaseAdmin
          .from("academic_works")
          .insert({
            ...payload,
            discipline_id: disciplineId,
            created_by: userId,
            status: "draft",
            delivery_type: "individual",
            grading_formula: "weighted_average",
            rubric: [],
          } as never)
          .select("id")
          .single();
        if (!error && data) {
          summary.academic_work = "created";
          summary.academic_work_id = data.id;
        } else if (error) {
          console.error("[lesson-plan-sync] insert academic_work:", error.message);
        }
      }
    } catch (err) {
      console.error("[lesson-plan-sync] academic_work sync failed:", err);
    }
  }

  return summary;
}
