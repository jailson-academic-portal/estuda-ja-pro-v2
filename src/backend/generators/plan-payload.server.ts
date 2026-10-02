import {
  loadDisciplineContext,
  loadGenerationMarkdown,
  saveGeneration,
} from "./generation-context.server";
import { generateApostilaLogic } from "./apostila.server";
import { generateActivityLogic, generateCaseStudyLogic } from "./case-study.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AnyRecord = Record<string, any>;

/** Accepts both camelCase and snake_case ids sent by the different modals. */
export function normalizeDisciplineId(data: AnyRecord): string {
  const id = data.disciplineId ?? data.discipline_id;
  if (typeof id !== "string" || !id) {
    throw new Error("Disciplina não identificada. Reabra o criador dentro da disciplina.");
  }
  return id;
}

export function normalizePlanId(data: AnyRecord): string | null {
  const id = data.planId ?? data.plan_id ?? data.lesson_plan_id ?? data.lessonPlanId;
  return typeof id === "string" && id ? id : null;
}

export type PlanContext = {
  id: string | null;
  title: string;
  markdown: string;
  themeBank: AnyRecord | null;
};

/** Loads the selected lesson plan, or the discipline's most recent one. */
export async function loadPlanContext(
  disciplineId: string,
  planId: string | null,
): Promise<PlanContext> {
  let id = planId;
  if (!id) {
    const { data } = await supabaseAdmin
      .from("ai_generations")
      .select("id")
      .eq("discipline_id", disciplineId)
      .eq("tool", "lesson_plan")
      .order("created_at", { ascending: false })
      .limit(1);
    id = data?.[0]?.id ?? null;
  }
  if (!id) return { id: null, title: "", markdown: "", themeBank: null };

  const { data: row } = await supabaseAdmin
    .from("ai_generations")
    .select("id, title, result, prompt")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { id: null, title: "", markdown: "", themeBank: null };
  const md = typeof row.result === "string" ? row.result : JSON.stringify(row.result ?? "");
  return {
    id: row.id,
    title: row.title ?? "",
    markdown: md,
    themeBank: ((row.prompt as any)?.banco_temas_sugeridos as AnyRecord) ?? null,
  };
}

function describeSelection(data: AnyRecord): string[] {
  const lines: string[] = [];
  const modules: string[] = Array.isArray(data.selected_modules) ? data.selected_modules.map(String) : [];
  const lessons: Array<{ module?: string; lesson?: string }> = Array.isArray(data.selected_lessons)
    ? data.selected_lessons
    : [];
  if (modules.length) lines.push(`Módulos selecionados: ${modules.join("; ")}`);
  if (lessons.length) {
    lines.push("Aulas selecionadas (gere conteúdo APENAS para estas aulas):");
    for (const l of lessons) lines.push(`- ${l.module ? `${l.module} — ` : ""}${l.lesson ?? ""}`);
  }
  if (!modules.length && !lessons.length) {
    lines.push("Escopo: todos os módulos e todas as aulas do plano.");
  }
  return lines;
}

/** Shared prompt body with discipline identification + lesson-plan content. */
async function buildPlanPrompt(
  disciplineId: string,
  plan: PlanContext,
  extraLines: (string | null)[],
  maxPlanChars = 16000,
): Promise<string> {
  const ctx = await loadDisciplineContext(disciplineId);
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("name, group_name, syllabus_text")
    .eq("id", disciplineId)
    .maybeSingle();

  return [
    `Disciplina: ${ctx.disciplineName || "Não informada"}`,
    ctx.teacherName ? `Professor(a): ${ctx.teacherName}` : null,
    ctx.institutionName ? `Instituição: ${ctx.institutionName}` : null,
    (disc as any)?.group_name ? `Curso/Turma: ${(disc as any).group_name}` : null,
    (disc as any)?.syllabus_text ? `Ementa da disciplina: ${String((disc as any).syllabus_text).slice(0, 4000)}` : null,
    plan.title ? `Plano de Aula base: ${plan.title}` : null,
    ...extraLines,
    "",
    "CONTEÚDO DO PLANO DE AULA (fonte pedagógica obrigatória):",
    plan.markdown ? plan.markdown.slice(0, maxPlanChars) : "(plano de aula não disponível)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Apostila creator: builds prompt from the plan and persists the result. */
export async function runApostilaFromPayload(data: AnyRecord, userId: string) {
  const disciplineId = normalizeDisciplineId(data);
  const plan = await loadPlanContext(disciplineId, normalizePlanId(data));
  const extras = [
    ...describeSelection(data),
    data.include_visual_suggestions === false
      ? "Não inclua sugestões de recursos visuais."
      : "Inclua sugestões de recursos visuais (figuras, fluxogramas, tabelas) em cada aula.",
  ];
  const prompt =
    typeof data.prompt === "string" && data.prompt.trim().length > 20
      ? data.prompt.trim()
      : await buildPlanPrompt(disciplineId, plan, extras);

  const result = await generateApostilaLogic({
    prompt,
    disciplineId,
    courseOverride: typeof data.course_override === "string" ? data.course_override : undefined,
    teacherOverride: typeof data.teacher_override === "string" ? data.teacher_override : undefined,
  });

  const firstModule =
    (Array.isArray(data.selected_modules) && data.selected_modules[0]) ||
    (Array.isArray(data.selected_lessons) && data.selected_lessons[0]?.module) ||
    "";
  const title = `Apostila${firstModule ? ` — ${String(firstModule)}` : plan.title ? ` — ${plan.title}` : ""}`;
  return saveGeneration({
    userId,
    disciplineId,
    tool: "apostila",
    title,
    prompt: { payload: data, planId: plan.id },
    result,
  });
}

/** Activity / academic-work syllabus creator. */
export async function runActivityFromPayload(data: AnyRecord, userId: string) {
  const disciplineId = normalizeDisciplineId(data);
  const plan = await loadPlanContext(disciplineId, normalizePlanId(data));
  const topic = String(data.module_topic ?? data.topic ?? "").trim();
  const kind = String(data.kind ?? "activity");
  const docLabel = kind === "work" ? "Trabalho Acadêmico" : "Atividade Acadêmica";
  const prompt =
    typeof data.prompt === "string" && data.prompt.trim().length > 20
      ? data.prompt.trim()
      : await buildPlanPrompt(
          disciplineId,
          plan,
          [
            topic ? `Tema: ${topic}` : null,
            `Tipo: ${docLabel}`,
            data.subtype ? `Formato: ${String(data.subtype)}` : null,
            data.extra_context ? `Orientações do professor: ${String(data.extra_context).slice(0, 3000)}` : null,
            Array.isArray(data.rubric_criteria) && data.rubric_criteria.length
              ? `Critérios de avaliação: ${JSON.stringify(data.rubric_criteria)}`
              : null,
          ],
          10000,
        );

  const result = await generateActivityLogic({ prompt, disciplineId, docLabel });
  const title = `${docLabel}${topic ? ` — ${topic}` : ""}`;
  return saveGeneration({
    userId,
    disciplineId,
    tool: "activity_syllabus",
    title,
    prompt: { payload: data, planId: plan.id },
    result,
  });
}

/** Case-study creator (uses the plan theme bank when no topic was typed). */
export async function runCaseStudyFromPayload(data: AnyRecord, userId: string) {
  const disciplineId = normalizeDisciplineId(data);
  const plan = await loadPlanContext(disciplineId, normalizePlanId(data));
  const bankThemes: string[] = Array.isArray(plan.themeBank?.estudos_de_caso)
    ? plan.themeBank!.estudos_de_caso.map(String)
    : [];
  const topic = String(data.module_topic ?? data.topic ?? "").trim() || bankThemes[0] || "";
  const prompt =
    typeof data.prompt === "string" && data.prompt.trim().length > 20
      ? data.prompt.trim()
      : await buildPlanPrompt(
          disciplineId,
          plan,
          [
            topic ? `Tema do estudo de caso: ${topic}` : null,
            bankThemes.length ? `Banco de temas do plano: ${bankThemes.join("; ")}` : null,
            data.extra_context ? `Orientações do professor: ${String(data.extra_context).slice(0, 3000)}` : null,
            Array.isArray(data.rubric_criteria) && data.rubric_criteria.length
              ? `Critérios de correção: ${JSON.stringify(data.rubric_criteria)}`
              : null,
          ],
          10000,
        );

  const result = await generateCaseStudyLogic({ prompt, disciplineId });
  const title = `Estudo de Caso${topic ? ` — ${topic}` : ""}`;
  return saveGeneration({
    userId,
    disciplineId,
    tool: "case_study",
    title,
    prompt: { payload: data, planId: plan.id },
    result,
  });
}
