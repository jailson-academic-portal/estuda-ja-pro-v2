import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getDisciplineAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertTeacherOrAdmin } = await import("./discipline-access.server");
    const { buildAnalytics } = await import("./analytics.server");
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    return buildAnalytics(data.discipline_id);
  });

export const getMyAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { buildAnalytics } = await import("./analytics.server");
    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("id")
      .eq("discipline_id", data.discipline_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (!enrolled) throw new Error("Você não está matriculado nesta disciplina.");
    return buildAnalytics(data.discipline_id, context.userId);
  });

export const getInstitutionAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireInstitution } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);

    // 1. Status de Diários & Frequências
    const { data: disciplines } = await supabaseAdmin
      .from("disciplines")
      .select("id, name, teacher_id")
      .eq("institution_id", instId)
      .eq("status", "active");

    const discIds = (disciplines ?? []).map(d => d.id);
    
    // Contagem de sessões e diários
    const [sessionsRes, diaryRes, studentsRes, profileRes] = await Promise.all([
      supabaseAdmin.from("attendance_sessions").select("discipline_id, id").in("discipline_id", discIds),
      supabaseAdmin.from("grade_entries").select("discipline_id, student_id, score").in("discipline_id", discIds),
      supabaseAdmin.from("discipline_students").select("discipline_id, student_id").in("discipline_id", discIds),
      supabaseAdmin.from("profiles").select("id, name").in("id", (disciplines ?? []).map(d => d.teacher_id).filter(Boolean) as string[]),
    ]);

    const teacherMap = new Map((profileRes.data ?? []).map(p => [p.id, p.name]));
    
    const consolidated = (disciplines ?? []).map(d => {
      const sessions = (sessionsRes.data ?? []).filter(s => s.discipline_id === d.id).length;
      const students = (studentsRes.data ?? []).filter(s => s.discipline_id === d.id).length;
      const grades = (diaryRes.data ?? []).filter(g => g.discipline_id === d.id && g.score !== null).length;
      
      return {
        id: d.id,
        name: d.name,
        teacher: teacherMap.get(d.teacher_id ?? "") || "Não atribuído",
        sessions_count: sessions,
        students_count: students,
        grades_filled: grades,
        completion_rate: students > 0 ? (grades / students) * 100 : 0
      };
    });

    // 2. Média Global
    const allGrades = (diaryRes.data ?? []).filter(g => g.score !== null).map(g => g.score as number);
    const globalAverage = allGrades.length ? allGrades.reduce((a, b) => a + b, 0) / allGrades.length : 0;

    // 3. Alerta de Evasão (Simulado com base nos dados reais disponíveis)
    const lowAttendanceCount = 0; // Seria calculado cruzando attendance_records

    // 4. Aderência da IA
    const { count: aiInteractions } = await supabaseAdmin
      .from("ai_generations")
      .select("*", { count: 'exact', head: true })
      .in("discipline_id", discIds);

    return {
      consolidated,
      globalAverage,
      lowAttendanceCount,
      aiInteractions: aiInteractions ?? 0
    };
  });

export const auditGradeChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
     // Auditoria simples baseada no updated_at das notas (em um sistema real teria uma tabela de logs dedicada)
     const { data: logs } = await supabaseAdmin
       .from("grade_entries")
       .select("student_id, assessment_id, score, updated_at")
       .eq("discipline_id", data.discipline_id)
       .order("updated_at", { ascending: false })
       .limit(50);
     
     return logs ?? [];
  });
