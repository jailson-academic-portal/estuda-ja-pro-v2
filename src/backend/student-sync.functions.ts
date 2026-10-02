import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Merge/repair do primeiro acesso do aluno.
 * - Busca o nome real (authorized_students) pela matrícula e grava em profiles.
 * - Reaponta vínculos (discipline_students, notas, presenças) de perfis
 *   duplicados/temporários com a mesma matrícula para o auth.uid() atual.
 */
export const syncStudentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const uid = context.userId;

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, name, enrollment_number, profile_type, institution_id")
        .eq("id", uid)
        .maybeSingle();
      if (!profile || profile.profile_type !== "student") return { ok: true, skipped: true };

      let matricula = (profile.enrollment_number ?? "").trim();
      if (!matricula) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
        const meta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>;
        const fromMeta = typeof meta['enrollment_number'] === "string" ? meta['enrollment_number'] : "";
        const fromEmail = (authUser?.user?.email ?? "").split("@")[0] ?? "";
        matricula = (fromMeta || fromEmail).trim();
      }
      if (!matricula) return { ok: true, skipped: true };
      matricula = matricula.toUpperCase();

      // 1) Nome real + instituição a partir da lista de matrículas autorizadas
      const { data: authorized } = await supabaseAdmin
        .from("authorized_students")
        .select("name, institution_id")
        .ilike("enrollment_number", matricula)
        .maybeSingle();

      const placeholder =
        !profile.name ||
        profile.name.trim().length === 0 ||
        /^estudante\b/i.test(profile.name.trim()) ||
        profile.name.trim().toUpperCase() === matricula;

      const patch: { enrollment_number?: string; name?: string; institution_id?: string } = {};
      if (profile.enrollment_number !== matricula) patch.enrollment_number = matricula;
      if (authorized?.name && placeholder) patch.name = authorized.name;
      if (authorized?.institution_id && !profile.institution_id) patch.institution_id = authorized.institution_id;
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("profiles").update(patch).eq("id", uid);
      }

      // 2) Adotar vínculos de perfis duplicados/temporários com a mesma matrícula.
      // SECURITY: só é permitido absorver um perfil que comprovadamente é um
      // registro provisório/placeholder — sem senha definida e que nunca fez
      // login. Sem essa verificação, um aluno poderia apontar a própria
      // matrícula para a de outro e herdar notas/presenças da vítima.
      const { data: dupeCandidates } = await supabaseAdmin
        .from("profiles")
        .select("id, password_set")
        .ilike("enrollment_number", matricula)
        .neq("id", uid);

      const dupes: { id: string }[] = [];
      for (const candidate of dupeCandidates ?? []) {
        if (candidate.password_set) continue;
        const { data: dupeAuth } = await supabaseAdmin.auth.admin.getUserById(candidate.id);
        const authUserRec = dupeAuth?.user;
        if (!authUserRec) {
          dupes.push({ id: candidate.id });
          continue;
        }
        if (authUserRec.last_sign_in_at) continue;
        dupes.push({ id: candidate.id });
      }

      let migratedEnrollments = 0;
      for (const dupe of dupes) {

        const { data: rows } = await supabaseAdmin
          .from("discipline_students")
          .select("id, discipline_id")
          .eq("student_id", dupe.id);

        for (const row of rows ?? []) {
          const { data: mine } = await supabaseAdmin
            .from("discipline_students")
            .select("id")
            .eq("discipline_id", row.discipline_id)
            .eq("student_id", uid)
            .maybeSingle();
          if (mine) {
            await supabaseAdmin.from("discipline_students").delete().eq("id", row.id);
          } else {
            await supabaseAdmin.from("discipline_students").update({ student_id: uid }).eq("id", row.id);
            migratedEnrollments++;
          }
        }

        await supabaseAdmin.from("grade_entries").update({ student_id: uid }).eq("student_id", dupe.id);
        await supabaseAdmin.from("attendance_records").update({ student_id: uid }).eq("student_id", dupe.id);
      }

      const { count } = await supabaseAdmin
        .from("discipline_students")
        .select("*", { count: "exact", head: true })
        .eq("student_id", uid);

      return {
        ok: true,
        name: patch.name ?? profile.name,
        enrollments: count ?? 0,
        migratedEnrollments,
      };
    } catch (err) {
      console.error("[syncStudentProfile] erro", err);
      return { ok: false, error: err instanceof Error ? err.message : "erro" };
    }
  });
