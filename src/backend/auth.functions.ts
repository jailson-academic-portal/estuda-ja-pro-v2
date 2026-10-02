import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Mark password as user-set after the first password change. */
export const markPasswordSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles")
      .update({ password_set: true }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Stats for the student dashboard (totals + attendance avg). */
export const getStudentStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const uid = context.userId;

      // Usamos o supabaseAdmin para garantir que as estatísticas reflitam a realidade
      // mesmo se o RLS estiver com problemas de sincronização temporária
      const { data: enrollments, error: enrError } = await supabaseAdmin
        .from("discipline_students").select("discipline_id").eq("student_id", uid);
      
      if (enrError) {
        console.error("[getStudentStats] enrollments fetch error", enrError);
        throw new Error(`Erro ao buscar matrículas: ${enrError.message}`);
      }

      const disciplineIds = (enrollments ?? []).map((e) => e.discipline_id);
      const totalDisciplines = disciplineIds.length;

      if (!totalDisciplines) {
        return {
          totalDisciplines: 0,
          materialsCount: 0,
          pendingActivities: 0,
          pendingExercises: 0,
          attendancePercent: null as number | null,
          attendanceByDiscipline: {} as Record<string, number>,
        };
      }

      // Parallel reads for stats using admin
      const [
        resMat,
        resActs,
        resSubs,
        resWorks,
        resWorkSubs,
        resEx,
        resExSubs,
        resRecs,
      ] = await Promise.all([
        supabaseAdmin.from("materials").select("*", { count: "exact", head: true })
          .in("discipline_id", disciplineIds).eq("status", "published"),
        supabaseAdmin.from("activities").select("id, due_at")
          .in("discipline_id", disciplineIds).eq("status", "published").limit(500),
        supabaseAdmin.from("activity_submissions").select("activity_id").eq("student_id", uid).limit(1000),
        supabaseAdmin.from("academic_works").select("id, due_at")
          .in("discipline_id", disciplineIds).eq("status", "published").limit(500),
        supabaseAdmin.from("academic_work_submissions").select("work_id").eq("student_id", uid).limit(1000),
        supabaseAdmin.from("exercises").select("id")
          .in("discipline_id", disciplineIds).eq("status", "published").limit(500),
        supabaseAdmin.from("exercise_submissions").select("exercise_id").eq("student_id", uid).limit(1000),
        supabaseAdmin
          .from("attendance_records")
          .select("status, attendance_sessions!inner(discipline_id)")
          .eq("student_id", uid)
          .limit(3000),
      ]);


      if (resMat.error) console.error("[getStudentStats] mat error", resMat.error);
      if (resActs.error) console.error("[getStudentStats] acts error", resActs.error);
      if (resSubs.error) console.error("[getStudentStats] subs error", resSubs.error);
      if (resWorks.error) console.error("[getStudentStats] works error", resWorks.error);
      if (resRecs.error) console.error("[getStudentStats] recs error", resRecs.error);

      const now = Date.now();
      const submittedActs = new Set((resSubs.data ?? []).map((s) => s.activity_id));
      const submittedWorks = new Set((resWorkSubs.data ?? []).map((s: any) => s.work_id));
      const submittedEx = new Set((resExSubs.data ?? []).map((s: any) => s.exercise_id));
      
      const pendingActs = (resActs.data ?? []).filter((a) =>
        !submittedActs.has(a.id) && (!a.due_at || new Date(a.due_at).getTime() > now),
      ).length;
      const pendingWorks = (resWorks.data ?? []).filter((w) =>
        !submittedWorks.has(w.id) && (!w.due_at || new Date(w.due_at).getTime() > now),
      ).length;
      const pendingActivities = pendingActs + pendingWorks;
      const pendingExercises = (resEx.data ?? []).filter((e) => !submittedEx.has(e.id)).length;

      type Rec = { status: string; attendance_sessions: { discipline_id: string } | { discipline_id: string }[] };
      const recs = (resRecs.data ?? []) as unknown as Rec[];
      const byDisc = new Map<string, { total: number; attended: number }>();
      let total = 0;
      let attended = 0;
      for (const r of recs) {
        const s = Array.isArray(r.attendance_sessions) ? r.attendance_sessions[0] : r.attendance_sessions;
        const did = s?.discipline_id;
        if (!did) continue;
        const cur = byDisc.get(did) ?? { total: 0, attended: 0 };
        cur.total += 1;
        if (r.status === "present" || r.status === "justified") cur.attended += 1;
        byDisc.set(did, cur);
        total += 1;
        if (r.status === "present" || r.status === "justified") attended += 1;
      }
      const attendancePercent = total > 0 ? Math.round((attended / total) * 100) : null;
      const attendanceByDiscipline: Record<string, number> = {};
      byDisc.forEach((v, k) => {
        if (v.total > 0) attendanceByDiscipline[k] = Math.round((v.attended / v.total) * 100);
      });

      return {
        totalDisciplines,
        materialsCount: resMat.count ?? 0,
        pendingActivities,
        pendingExercises,
        attendancePercent,
        attendanceByDiscipline,
      };
    } catch (err) {
      console.error("[getStudentStats] unexpected error", err);
      throw new Error(err instanceof Error ? err.message : "Erro desconhecido ao carregar estatísticas");
    }
  });
