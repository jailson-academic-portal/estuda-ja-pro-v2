import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents } from "./notifications.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

const AssessmentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  weight: z.number().min(0).max(100),
  max_score: z.number().min(0.1).max(100).default(10),
  sub_items: z.array(z.object({
    id: z.string().min(1).max(24),
    name: z.string().min(1).max(80),
  })).max(20).optional(),
});

const RecoveryConfigSchema = z.object({
  enabled: z.boolean(),
  name: z.string().min(1).max(80),
  max_score: z.number().min(0.1).max(100).default(10),
  mode: z.enum(["lowest", "specific"]),
  target_assessment_id: z.string().nullable().optional(),
}).nullable().optional();

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

export const saveGradeStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    assessments: z.array(AssessmentSchema).min(1).max(20),
    formula: z.enum(["weighted_average", "simple_average"]).default("weighted_average"),
    passing_average: z.number().min(0).max(100),
    recovery_min: z.number().min(0).max(10).optional(),
    recovery_average: z.number().min(0).max(100).nullable().optional(),
    grade_scale: z.union([z.literal(10), z.literal(100)]).default(10),
    recovery_config: RecoveryConfigSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    if (data.passing_average > data.grade_scale) {
      throw new Error("Média de aprovação não pode ser maior que a escala");
    }
    if (data.recovery_average != null && data.recovery_average > data.passing_average) {
      throw new Error("Média de recuperação não pode ser maior que a média de aprovação");
    }
    const totalWeight = data.assessments.reduce((s, a) => s + (a.weight ?? 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw new Error(`A soma dos pesos deve ser 100% (atual: ${totalWeight}%)`);
    }
    const { error } = await supabaseAdmin.from("grade_structures").upsert({
      discipline_id: data.discipline_id,
      assessments: data.assessments,
      formula: data.formula,
      passing_average: data.passing_average,
      recovery_min: data.recovery_min ?? null,
      recovery_average: data.recovery_average ?? null,
      grade_scale: data.grade_scale,
      recovery_config: data.recovery_config ?? null,
    } as never, { onConflict: "discipline_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertGradeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    student_id: z.string().uuid(),
    assessment_id: z.string().min(1).max(120),
    score: z.number().min(0).max(100).nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("grade_entries").upsert({
      discipline_id: data.discipline_id,
      student_id: data.student_id,
      assessment_id: data.assessment_id,
      score: data.score,
    }, { onConflict: "discipline_id,student_id,assessment_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearRecoveryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    student_id: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("grade_entries").delete()
      .eq("discipline_id", data.discipline_id)
      .eq("student_id", data.student_id)
      .eq("assessment_id", "__recovery__");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const publishGrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    await notifyEnrolledStudents(
      data.discipline_id,
      "grade_published",
      "Notas atualizadas",
      "O professor atualizou as notas da disciplina.",
      `/disciplines/${data.discipline_id}`,
    );
    return { ok: true };
  });