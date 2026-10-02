import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents, notifyUsers } from "./notifications.server";
import { callAIJson } from "./ai.server";
import { assertTeacherOrAdmin, userIsAdmin } from "./discipline-access.server";
import { notifyTeacherOfSubmission } from "./submissions-notify.server";
import { buildDocumentFilename } from "@/lib/document-filename";
import { stripLeadingStandardHeader, normalizeActivitySyllabusLabels, extractStandardHeaderDocLine } from "@/lib/document-header";
import { ACTIVITY_SUBTYPE_LABELS } from "@/lib/rubric-library";
import { isLaunchableDiaryAssessmentId, type DiaryAssessmentSource } from "@/lib/diary-assessments";
const FEMININE_ACTIVITY_SUBTYPES = new Set([
  "redacao", "visita_tecnica", "aula_pratica", "free_activity",
]);

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "documento";
}

const RubricCriterion = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(30000).optional(),
  weight: z.number().min(0).max(100),
  max_score: z.number().min(0.1).max(100).default(10),
});

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

async function assertValidDiaryAssessmentId(disciplineId: string, diaryAssessmentId?: string | null) {
  if (!diaryAssessmentId) return;
  const { data, error } = await supabaseAdmin
    .from("grade_structures")
    .select("assessments")
    .eq("discipline_id", disciplineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assessments = (data?.assessments as unknown as DiaryAssessmentSource[]) ?? [];
  if (!isLaunchableDiaryAssessmentId(assessments, diaryAssessmentId)) {
    throw new Error("Campo do diário inválido. Se a coluna tiver sub-itens, selecione um subcampo específico.");
  }
}

export const saveActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    id: z.string().uuid().optional(),
    discipline_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    instructions: z.string().trim().max(30000).optional(),
    subtype: z.enum([
      "case_study", "care_plan", "pharmaceutical_plan", "practical_report", "free_activity",
      "redacao", "seminario", "debate", "visita_tecnica", "aula_pratica", "workshop",
    ]),
    due_at: z.string().optional().nullable(),
    due_time: z.string().optional().nullable(),
    late_tolerance_date: z.string().optional().nullable(),
    late_tolerance_time: z.string().optional().nullable(),
    late_penalty_type: z.enum(["percentage", "fixed"]).optional().nullable(),
    rubric: z.array(RubricCriterion).max(20).default([]),
    grading_formula: z.enum(["weighted_average", "simple_average"]).default("weighted_average"),
    allow_attachments: z.boolean().default(false),
    max_attachments: z.number().min(0).max(10).default(0),
    delivery_type: z.enum(["individual", "group"]).default("individual"),
    max_group_size: z.number().int().min(2).max(50).nullable().optional(),
    allow_late: z.boolean().default(false),
    late_penalty_per_day: z.number().min(0).max(100).nullable().optional(),
    diary_assessment_id: z.string().max(80).nullable().optional(),
    publish: z.boolean().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    await assertValidDiaryAssessmentId(data.discipline_id, data.diary_assessment_id);
    const status = data.publish ? "published" : "draft";
    const payload = {
      discipline_id: data.discipline_id,
      title: data.title,
      instructions: data.instructions ?? null,
      subtype: data.subtype as never,
      due_at: data.due_at ?? null,
      due_time: data.due_time ?? "23:59:59",
      late_tolerance_date: data.late_tolerance_date ?? null,
      late_tolerance_time: data.late_tolerance_time ?? "23:59:59",
      late_penalty_type: data.late_penalty_type ?? "fixed",
      rubric: data.rubric,
      grading_formula: data.grading_formula,
      allow_attachments: data.allow_attachments,
      max_attachments: data.max_attachments,
      delivery_type: data.delivery_type,
      max_group_size: data.delivery_type === "group" ? (data.max_group_size ?? 2) : null,
      allow_late: data.allow_late,
      late_penalty_per_day: data.allow_late ? (data.late_penalty_per_day ?? 0) : null,
      diary_assessment_id: data.diary_assessment_id ?? null,
      status: status as "published" | "draft",
      created_by: context.userId,
    };
    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("activities")
        .update(payload)
        .eq("id", data.id)
        .eq("created_by", context.userId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Atividade não encontrada ou sem permissão");
    } else {
      const { error } = await supabaseAdmin.from("activities").insert(payload);
      if (error) throw new Error(error.message);
    }
    if (data.publish) {
      await notifyEnrolledStudents(
        data.discipline_id, "new_activity", "Nova atividade publicada",
        data.title, `/disciplines/${data.discipline_id}`,
      );
    }
    return { ok: true };
  });

export const deleteActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin.from("activities").select("discipline_id").eq("id", data.id).maybeSingle();
    if (!a) throw new Error("Atividade não encontrada");
    await assertTeacher(a.discipline_id, context.userId);
    await supabaseAdmin.from("activities").delete().eq("id", data.id);
    return { ok: true };
  });

/**
 * Persiste a ordem de exibição das atividades de uma disciplina (setas
 * subir/descer na lista). Recebe os ids na ordem desejada e grava
 * sort_order sequencial (0..n-1). Atividades fora da lista não são alteradas.
 */
export const reorderActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    ordered_ids: z.array(z.string().uuid()).min(1).max(500),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    for (let i = 0; i < data.ordered_ids.length; i++) {
      const { error } = await supabaseAdmin
        .from("activities")
        .update({ sort_order: i })
        .eq("id", data.ordered_ids[i])
        .eq("discipline_id", data.discipline_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const submitActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    activity_id: z.string().uuid(),
    student_id: z.string().uuid().optional(),
    file_url: z.string().max(500).optional(),
    answers: z.record(z.string()).optional(),
    questions: z.array(z.string()).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const studentId = data.student_id || context.userId;
    
    // Usamos um único INSERT definitivo (upsert com student_id explícito)
    const { error } = await supabaseAdmin.from("activity_submissions").upsert({
      activity_id: data.activity_id,
      student_id: studentId,
      file_url: data.file_url ?? "inline_submission",
      attachments: { 
        answers: data.answers || {}, 
        questions: data.questions || [] 
      } as any,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    }, { onConflict: "activity_id,student_id" });
    if (error) throw new Error(error.message);
    const { data: act } = await supabaseAdmin
      .from("activities")
      .select("discipline_id,title")
      .eq("id", data.activity_id)
      .maybeSingle();
    if (act) {
      await notifyTeacherOfSubmission({
        disciplineId: act.discipline_id,
        studentId: context.userId,
        kind: "activity",
        parentTitle: act.title,
      });
    }
    return { ok: true };
  });

/** Teacher requests AI correction for a submission. */
export const correctActivityWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    submission_id: z.string().uuid(),
    submission_text: z.string().min(1).max(50000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("activity_submissions").select("*, activities!inner(*)")
      .eq("id", data.submission_id).maybeSingle();
    if (!sub) throw new Error("Submissão não encontrada");
    const act = sub.activities as { discipline_id: string; rubric: unknown; instructions: string | null; title: string };
    await assertTeacher(act.discipline_id, context.userId);

    const result = await callAIJson<{
      rubric_scores: Array<{ id: string; score: number; comment: string }>;
      total_score: number;
      summary: string;
      strengths: string[];
      improvements: string[];
    }>({
      system: "Você é um corretor acadêmico rigoroso. Avalie a submissão de acordo com cada critério da rubrica e responda em JSON.",
      user: `Atividade: ${act.title}\nInstruções: ${act.instructions ?? "—"}\nRubrica: ${JSON.stringify(act.rubric)}\n\nSubmissão do aluno:\n${data.submission_text}\n\nResponda em JSON com: rubric_scores (array com id, score, comment), total_score (média ponderada 0-10), summary, strengths (array), improvements (array).`,
    });

    await supabaseAdmin.from("activity_submissions").update({
      ai_report: result as unknown as never,
      rubric_scores: result.rubric_scores as unknown as never,
      total_score: result.total_score,
      status: "ai_corrected",
    }).eq("id", data.submission_id);
    return result;
  });

export const releaseActivityFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    submission_id: z.string().uuid(),
    teacher_comment: z.string().trim().max(30000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("activity_submissions").select("*, activities!inner(discipline_id)")
      .eq("id", data.submission_id).maybeSingle();
    if (!sub) throw new Error("Submissão não encontrada");
    const act = sub.activities as unknown as { discipline_id: string };
    await assertTeacher(act.discipline_id, context.userId);
    await supabaseAdmin.from("activity_submissions").update({
      released_at: new Date().toISOString(),
      status: "released",
      teacher_comment: data.teacher_comment ?? null,
    }).eq("id", data.submission_id);
    await notifyUsers(
      [sub.student_id], "feedback_available", "Feedback de atividade disponível",
      undefined, `/disciplines/${act.discipline_id}`,
    );
    return { ok: true };
  });

/**
 * Exports an activity statement (enunciado) as a branded PDF using the SAME
 * renderer/header as apostilas and materials. Available to the teacher and to
 * enrolled students (for published activities), producing an IDENTICAL PDF for
 * both. The stale header baked at dispatch time is stripped and rebuilt from
 * live discipline data so the professor's name and the activity-type label are
 * always correct.
 */
export const exportActivityPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: activity } = await supabaseAdmin
      .from("activities")
      .select("id,discipline_id,title,instructions,subtype,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!activity) throw new Error("Atividade não encontrada");

    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("teacher_id")
      .eq("id", activity.discipline_id)
      .maybeSingle();
    const allowedTeacher = disc?.teacher_id === context.userId || (await userIsAdmin(context.userId));
    let allowedStudent = false;
    if (!allowedTeacher && activity.status === "published") {
      const { data: enrollment } = await supabaseAdmin
        .from("discipline_students")
        .select("id")
        .eq("discipline_id", activity.discipline_id)
        .eq("student_id", context.userId)
        .maybeSingle();
      allowedStudent = Boolean(enrollment);
    }
    if (!allowedTeacher && !allowedStudent) throw new Error("Sem permissão");

    // Rebuild a fresh standardized header (correct professor name + activity
    // type label) and drop any stale header baked into the stored instructions.
    const subtypeLabel = ACTIVITY_SUBTYPE_LABELS[activity.subtype] ?? "Atividade";
    const article = FEMININE_ACTIVITY_SUBTYPES.has(activity.subtype) ? "da" : "do";
    const body = normalizeActivitySyllabusLabels(
      stripLeadingStandardHeader(activity.instructions),
      subtypeLabel,
      article,
    );
    const { buildStandardDocumentHeader } = await import("./ai-assistant.functions");
    const { buildMaterialDocumentPDF } = await import("./ai-export.functions");
    // O cabeçalho do aluno deve ser IDÊNTICO ao do professor. Preservamos a
    // linha de identificação que a IA gravou no cabeçalho original (ex.:
    // "**Estudo de Caso:** Módulo 2: …") reconstruindo-a a partir dos dados
    // vivos da disciplina. Exceção: ementas cujo corpo já traz "EMENTA — <TIPO>"
    // — nesse caso omitimos a linha para não duplicar
    // ("Estudo de caso: Ementa - Estudo de Caso 1").
    const docLine = extractStandardHeaderDocLine(activity.instructions);
    const bodyHasEmentaHeading = /^#{1,6}\s*EMENTA\s*[—–-]/im.test(body);
    const header = await buildStandardDocumentHeader(
      activity.discipline_id,
      docLine && !bodyHasEmentaHeading
        ? { docLabel: docLine.label, docValue: docLine.value }
        : undefined,
    );
    const markdown = header ? `${header}\n${body}` : body;
    const bytes = await buildMaterialDocumentPDF(activity.title, null, markdown, null);
    return {
      filename: `${sanitizeFilename(buildDocumentFilename(activity.title, markdown))}.pdf`,
      mime: "application/pdf",
      base64: bufferToBase64(bytes),
    };
  });