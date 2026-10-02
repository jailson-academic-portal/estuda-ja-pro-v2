import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TOOL_KEYS, ToolKey, TOOL_LABELS, JsonValue, SYSTEMS } from "./ai-assistant-core.server";
import { buildStandardDocumentHeader } from "./ai-assistant-common.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { extractAIContent } from "@/lib/ai-content";
import { callAIText } from "./ai.server";

// Re-exports for compatibility with other modules
export { TOOL_KEYS, TOOL_LABELS };
export type { ToolKey };
export { buildStandardDocumentHeader };

/* ============================================================================
 * Helper Functions (preserved for UI compatibility)
 * ============================================================================ */

export const listAIGenerations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({
    discipline_id: z.string().uuid(),
    tool: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    let query = supabaseAdmin
      .from("ai_generations")
      .select("id, title, tool, created_at, discipline_id")
      .eq("discipline_id", data.discipline_id)
      .eq("user_id", context.userId);
    if (data.tool) query = query.eq("tool", data.tool);
    const { data: rows, error } = await query
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    // UI expects { items: [] } based on AIAssistantModule.tsx usage
    return { items: rows || [] };
  });


export const getAIGeneration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("ai_generations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Este documento não está mais disponível (pode ter sido excluído).");
    // Owner, or any teacher/admin of the same discipline, may open it.
    if (row.user_id !== context.userId) {
      await assertTeacherOrAdmin(row.discipline_id as string, context.userId);
    }
    return row;
  });

export const deleteAIGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("ai_generations")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAIGenerationContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ id: z.string().uuid(), content: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("ai_generations")
      .update({ result: data.content as any })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================================
 * Thin Wrappers for AI Generation (Redirecting to generators/*.server.ts)
 * ============================================================================ */

import { generateLessonPlanLogic, generateLessonPlanDocument } from "./generators/lesson-plan.server";
export const generateLessonPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({
    prompt: z.string().min(1),
    extraContext: z.string().optional(),
    discipline_id: z.string().uuid(),
    clinicalThemes: z
      .array(z.object({ module: z.number().int().positive(), theme: z.string().max(30000) }))
      .optional(),
    themeBankConfig: z
      .object({
        caseStudies: z.boolean(),
        clinicalCases: z.boolean(),
        academicWork: z.boolean(),
        extraActivities: z.boolean(),
        academicWorkTypes: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
        practicalModules: z.array(z.number().int().positive()).max(30).optional(),
      })
      .optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    const { markdown, themeBank } = await generateLessonPlanDocument({
      prompt: data.prompt,
      extraContext: data.extraContext,
      clinicalThemes: data.clinicalThemes ?? [],
      themeBankConfig: data.themeBankConfig,
    });
    if (typeof markdown !== "string" || markdown.trim().length < 40) {
      throw new Error("A IA não conseguiu gerar o plano completo. Tente novamente.");
    }
    const { saveGeneration, loadDisciplineContext } = await import("./generators/generation-context.server");
    const ctx = await loadDisciplineContext(data.discipline_id);
    const title = `Plano de Aula${ctx.disciplineName ? ` — ${ctx.disciplineName}` : ""} — ${new Date().toLocaleDateString("pt-BR")}`;
    const saved = await saveGeneration({
      userId: context.userId,
      disciplineId: data.discipline_id,
      tool: "lesson_plan",
      title,
      prompt: {
        original: data.prompt,
        extraContext: data.extraContext ?? null,
        banco_temas_sugeridos: themeBank,
      },
      result: markdown,
    });

    // Sincroniza os blocos estruturados com Atividades Extras, SimulSaúde e Trabalhos.
    let integration: Awaited<ReturnType<typeof import("./generators/lesson-plan-sync.server").syncLessonPlanItems>> | null = null;
    try {
      const { syncLessonPlanItems } = await import("./generators/lesson-plan-sync.server");
      integration = await syncLessonPlanItems({
        disciplineId: data.discipline_id,
        generationId: (saved as any).id,
        userId: context.userId,
        themeBank,
      });
    } catch (err) {
      console.error("[generateLessonPlan] sync failed:", err);
    }

    return { ...(saved as Record<string, unknown>), integration } as typeof saved & { integration: typeof integration };
  });


import { generateApostilaLogic } from "./generators/apostila.server";
import {
  normalizeDisciplineId,
  runApostilaFromPayload,
  runActivityFromPayload,
  runCaseStudyFromPayload,
} from "./generators/plan-payload.server";

export const generateApostila = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = normalizeDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    return runApostilaFromPayload(data, context.userId);
  });

import { runSlidesFromPayload, runAssessmentFromPayload, pickDisciplineId } from "./generators/payload-prompt.server";

export const generateSlidesFromApostila = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = pickDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    return runSlidesFromPayload(data, context.userId);
  });

export const generateAssessmentFromApostila = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = pickDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    const tool = data.kind === "exercicio" || data.kind === "exercise_list" ? "exercise_list" : "quiz";
    return runAssessmentFromPayload(data, context.userId, tool);
  });

export const generateExerciseListFromApostila = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = pickDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    return runAssessmentFromPayload(data, context.userId, "exercise_list");
  });


import { generateActivityLogic, generateCaseStudyLogic } from "./generators/case-study.server";
export const generateActivitySyllabusFromPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = normalizeDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    return runActivityFromPayload(data, context.userId);
  });

export const generateCaseStudyFromPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.record(z.any()).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const disciplineId = normalizeDisciplineId(data);
    await assertTeacherOrAdmin(disciplineId, context.userId);
    return runCaseStudyFromPayload(data, context.userId);
  });


/* ============================================================================
 * Legacy / Shared Generation
 * ============================================================================ */

export const generateAIContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({
    tool: z.string(),
    prompt: z.string().min(1),
    discipline_id: z.string().uuid(),
    extra_context: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    if (data.tool === "lesson_plan") return generateLessonPlanLogic({ prompt: data.prompt, extraContext: data.extra_context });
    if (data.tool === "apostila") return generateApostilaLogic({ prompt: data.prompt, disciplineId: data.discipline_id });
    if (data.tool === "slides") return runSlidesFromPayload({ prompt: data.prompt, discipline_id: data.discipline_id }, context.userId);
    if (data.tool === "activity_syllabus") return generateActivityLogic({ prompt: data.prompt, disciplineId: data.discipline_id, docLabel: "Atividade Acadêmica" });
    if (data.tool === "case_study") return generateCaseStudyLogic({ prompt: data.prompt, disciplineId: data.discipline_id });
    
    // Generic generator for small tools
    const system = SYSTEMS[data.tool as ToolKey] || SYSTEMS.summary;
    const userPrompt = data.prompt;
    const raw = extractAIContent(
      await callAIText({ system, user: userPrompt, model: "google/gemini-2.5-flash" })
    ).replace(/\\n/g, "\n");

    const title = `${TOOL_LABELS[data.tool as ToolKey] || "Geração"} — ${new Date().toLocaleDateString("pt-BR")}`;
    const { data: saved, error } = await supabaseAdmin
      .from("ai_generations")
      .insert({
        user_id: context.userId,
        discipline_id: data.discipline_id,
        tool: data.tool,
        title,
        prompt: { original: data.prompt },
        result: raw as any,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const chatWithAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ 
    discipline_id: z.string().uuid(),
    is_student_tutor: z.boolean().optional(),
    messages: z.array(z.object({
      role: z.string(),
      content: z.string()
    }))
  }).parse(input))
  .handler(async ({ data, context }) => {
     await assertTeacherOrAdmin(data.discipline_id, context.userId);
    const system = data.is_student_tutor 
      ? SYSTEMS.study_guide 
      : "Você é um assistente pedagógico especializado em ensino superior.";
    const user = data.messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
    const raw = extractAIContent(
      await callAIText({ system, user, model: "google/gemini-2.5-flash" })
    );
    return { content: raw };
  });

/* ============================================================================
 * Exercise / Assessment Publishing Helpers
 * ============================================================================ */

async function loadGenerationForPublish(generationId: string, userId: string) {
  const { data: gen, error } = await supabaseAdmin
    .from("ai_generations")
    .select("id, title, tool, result, prompt, discipline_id")
    .eq("id", generationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!gen) throw new Error("Geração não encontrada");
  if (!gen.discipline_id) throw new Error("Geração sem disciplina vinculada");
  await assertTeacherOrAdmin(gen.discipline_id, userId);
  const { parseQuestionsFromText } = await import("@/lib/question-parser");
  const parsed = parseQuestionsFromText(
    typeof gen.result === "string" ? gen.result : (gen.result as unknown),
  );
  // Questões sem alternativas não são publicáveis nem corrigíveis; descartamos
  // aqui para que preview e publicação usem exatamente a mesma lista/índices.
  const questions = parsed.filter((q) => (q.options?.length ?? 0) >= 2);
  // Quantidade esperada, quando o prompt registrou o número pedido.
  let expectedQuestions: number | null = null;
  const promptObj = (gen.prompt ?? {}) as Record<string, any>;
  const requested = Number(
    promptObj?.requested_questions ?? promptObj?.payload?.total_questions ?? 0,
  );
  if (Number.isFinite(requested) && requested > 0) {
    expectedQuestions = Math.round(requested);
  } else {
    const promptText =
      typeof gen.prompt === "string" ? gen.prompt : JSON.stringify(gen.prompt ?? "");
    const hint = promptText?.match(/(\d{1,3})\s*quest[oõ]es/i);
    if (hint) expectedQuestions = Number(hint[1]);
  }
  return { gen, questions, expectedQuestions };
}

export const previewExerciseListQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ generation_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { questions, expectedQuestions } = await loadGenerationForPublish(
      data.generation_id,
      context.userId,
    );
    return {
      questions: questions.map((q) => ({
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      })),
      totalPoints: 10,
      expectedQuestions,
    };
  });

export const publishExerciseListAsExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({
    generation_id: z.string().uuid(),
    points: z.array(z.number().min(0.1).max(1000)).optional(),
    title: z.string().trim().max(500).optional(),
    /** Gabarito confirmado pelo professor: índice por questão (-1 = não definido). */
    correct_indexes: z.array(z.number().int().min(-1).max(10)).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { gen, questions } = await loadGenerationForPublish(
      data.generation_id,
      context.userId,
    );
    if (questions.length === 0) throw new Error("Nenhuma questão extraída da geração.");
    const merged = questions.map((q, i) => {
      const override = data.correct_indexes?.[i];
      const idx = override != null && override >= 0 ? override : q.correctIndex;
      return { ...q, correctIndex: idx };
    });
    const missing = merged.findIndex((q) => q.correctIndex < 0 || q.correctIndex >= q.options.length);
    if (missing >= 0) {
      throw new Error(
        `Confirme o gabarito da questão ${missing + 1} antes de liberar para os alunos.`,
      );
    }
    const { sanitizeGeneratedQuestionText, dedupeOptionPrefixes } = await import(
      "@/lib/text-sanitize"
    );
    const title = (data.title?.trim() || gen.title || "Lista de exercícios").slice(0, 500);
    // Preserva o módulo (apostila escolhida) e a aula para que a lista apareça
    // agrupada por Módulo → Aula na interface do aluno e do professor.
    const genPrompt = (gen.prompt ?? {}) as Record<string, any>;
    const payload = (genPrompt.payload ?? {}) as Record<string, any>;
    const moduleLabel = String(payload.module_label ?? genPrompt.module_label ?? "").trim();
    const lessonTitle = String(payload.lesson_title ?? genPrompt.lesson_title ?? "").trim();
    const { data: exercise, error: exErr } = await supabaseAdmin
      .from("exercises")
      .insert({
        discipline_id: gen.discipline_id!,
        title,
        module_label: moduleLabel ? moduleLabel.slice(0, 300) : null,
        topic: lessonTitle ? lessonTitle.slice(0, 300) : null,
        type: "multiple_choice" as const,
        question_count: merged.length,
        status: "published" as const,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (exErr) throw new Error(exErr.message);

    const rows = merged.map((q, i) => {
      const options = q.options.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(o)));
      return {
        exercise_id: exercise.id,
        position: i,
        prompt: sanitizeGeneratedQuestionText(q.prompt),
        options: options as unknown as never,
        correct_answer: options[q.correctIndex] as unknown as never,
        explanation: q.explanation ? sanitizeGeneratedQuestionText(q.explanation) : null,
        points: data.points?.[i] ?? Number((10 / merged.length).toFixed(2)),
      };
    });
    const { error: qErr } = await supabaseAdmin.from("exercise_questions").insert(rows);
    if (qErr) {
      await supabaseAdmin.from("exercises").delete().eq("id", exercise.id);
      throw new Error(qErr.message);
    }
    const { notifyEnrolledStudents } = await import("./notifications.server");
    await notifyEnrolledStudents(
      gen.discipline_id!,
      "new_exercise",
      "Novo exercício publicado",
      title,
      `/disciplines/${gen.discipline_id}`,
    );
    return { ok: true, exercise_id: exercise.id, question_count: rows.length };
  });


export const getAssessmentHeader = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
     await assertTeacherOrAdmin(data.discipline_id, context.userId);
     const { loadDisciplineContext } = await import("./generators/generation-context.server");
     const ctx = await loadDisciplineContext(data.discipline_id);
     return {
       institution: ctx.institutionName,
       discipline: ctx.disciplineName,
       professor: ctx.teacherName,
     };
  });
