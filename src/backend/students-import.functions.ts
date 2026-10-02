import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MATRICULA_REGEX = /^[A-Za-z]{2}\d{1,9}$/;

const rowSchema = z.object({
  enrollment: z.string().trim().min(1).max(50).toUpperCase().refine(v => MATRICULA_REGEX.test(v), {
    message: "A matrícula deve conter 2 letras seguidas de até 9 números"
  }),
  name: z.string().trim().min(1).max(120),
});

const inputSchema = z.object({
  rows: z.array(rowSchema).min(1).max(5000),
  default_password: z.string().min(6).max(72).optional(),
  discipline_id: z.string().uuid().optional(),
});

function matriculaToSyntheticEmail(matricula: string) {
  return `${matricula.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}@students.estudaja.local`;
}

export const adminImportStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("profile_type, institution_id").eq("id", userId).maybeSingle();
    if (profile?.profile_type !== "admin" && profile?.profile_type !== "institution") {
      throw new Error("Apenas admin ou instituição podem importar alunos");
    }
    const institutionId = profile.profile_type === "institution" ? profile.institution_id : null;
    const password = data.default_password ?? "estudaja@123";

    // When a discipline is provided, validate it belongs to the caller's institution
    // (platform admins may use any discipline).
    let enrollDisciplineId: string | null = null;
    if (data.discipline_id) {
      const { data: disc } = await supabaseAdmin
        .from("disciplines").select("id, institution_id").eq("id", data.discipline_id).maybeSingle();
      if (!disc) throw new Error("Disciplina não encontrada");
      if (institutionId && disc.institution_id !== institutionId) throw new Error("Disciplina de outra instituição");
      enrollDisciplineId = disc.id;
    }
    const enroll = async (studentId: string) => {
      if (!enrollDisciplineId) return;
      await supabaseAdmin.from("discipline_students").upsert(
        { discipline_id: enrollDisciplineId, student_id: studentId } as never,
        { onConflict: "discipline_id,student_id", ignoreDuplicates: true },
      );
    };

    const results: { enrollment: string; name: string; status: "created" | "exists" | "error"; error?: string }[] = [];

    const seen = new Set<string>();
    for (const row of data.rows) {
      const key = row.enrollment.trim().toLowerCase();
      if (seen.has(key)) {
        results.push({ enrollment: row.enrollment, name: row.name, status: "exists", error: "Matrícula duplicada no arquivo" });
        continue;
      }
      seen.add(key);
      const email = matriculaToSyntheticEmail(row.enrollment);
      try {
        const { data: existing } = await supabaseAdmin
          .from("profiles").select("id").ilike("enrollment_number", row.enrollment.trim()).maybeSingle();
        if (existing) {
          await enroll(existing.id);
          results.push({ enrollment: row.enrollment, name: row.name, status: "exists" });
          continue;
        }

        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            name: row.name,
            enrollment_number: row.enrollment,
            profile_type: "student",
          },
        });
        if (cErr || !created.user) {
          results.push({ enrollment: row.enrollment, name: row.name, status: "error", error: cErr?.message ?? "Erro" });
          continue;
        }

        // Forçar a senha padrão no auth.users para garantir que o login funcione imediatamente
        await supabaseAdmin.auth.admin.updateUserById(created.user.id, {
          password: password,
        });

        if (institutionId) {
          await supabaseAdmin.from("profiles").update({ 
            institution_id: institutionId, 
            password_set: false,
            status: "active" 
          }).eq("id", created.user.id);
        } else {
          await supabaseAdmin.from("profiles").update({ 
            password_set: false,
            status: "active" 
          }).eq("id", created.user.id);
        }
        await enroll(created.user.id);

        results.push({ enrollment: row.enrollment, name: row.name, status: "created" });
      } catch (e) {
        results.push({
          enrollment: row.enrollment, name: row.name,
          status: "error",
          error: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
    }

    return {
      total: data.rows.length,
      created: results.filter((r) => r.status === "created").length,
      exists: results.filter((r) => r.status === "exists").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    };
  });