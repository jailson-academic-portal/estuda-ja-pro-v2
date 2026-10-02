import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function matriculaToEmail(matricula: string) {
  return `${matricula.trim().toLowerCase()}@students.estudaja.local`;
}

/**
 * Login exclusivo por matrícula para alunos.
 * A matrícula é a única entrada do aluno; a sessão resultante continua sendo
 * uma sessão real e de uso único do Auth, necessária para proteger o painel.
 */
export const studentMatriculaLogin = createServerFn({ method: "POST" })
  .validator((d: { matricula: string }) =>
    z.object({
      matricula: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9.-]+$/, "Formato de matrícula inválido"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const matricula = data.matricula.trim();
    const withTimeout = async <T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          p as Promise<T>,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const columns = "id, name, profile_type, status, enrollment_number, institution_id";
      type LoginProfile = {
        id: string;
        name: string | null;
        profile_type: string | null;
        status: string | null;
        enrollment_number: string | null;
        institution_id: string | null;
      };

      let profile: LoginProfile | null = null;
      let error: { message: string } | null = null;
      const exact = await withTimeout(
        supabaseAdmin.from("profiles").select(columns).eq("enrollment_number", matricula).limit(1).maybeSingle(),
        1500,
        "profile-eq",
      );
      profile = (exact.data as LoginProfile | null) ?? null;
      error = exact.error ?? null;

      if (!profile && !error) {
        const loose = await withTimeout(
          supabaseAdmin.from("profiles").select(columns).ilike("enrollment_number", matricula).limit(1).maybeSingle(),
          1500,
          "profile-ilike",
        );
        profile = (loose.data as LoginProfile | null) ?? null;
        error = loose.error ?? null;
      }

      if (error) {
        console.error("[studentMatriculaLogin] db error:", error.message);
        return { ok: false as const, reason: "server" as const };
      }
      if (!profile || profile.profile_type !== "student") {
        return { ok: false as const, reason: "not_found" as const };
      }
      if (profile.status === "inactive") {
        return { ok: false as const, reason: "inactive" as const };
      }

      const enrollment = (profile.enrollment_number ?? matricula).trim();
      const email = matriculaToEmail(enrollment);

      // A troca do token é feita pelo cliente; nenhuma senha é solicitada ao aluno.
      const link = await withTimeout(
        supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email }),
        8000,
        "generate-link",
      );
      let hashedToken = link.data?.properties?.hashed_token;

      if (link.error || !hashedToken) {
        const created = await withTimeout(
          supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              profile_type: "student",
              enrollment_number: enrollment,
              name: profile.name ?? `Estudante ${enrollment}`,
            },
          }),
          8000,
          "create-user",
        );
        if (created.error) {
          console.error("[studentMatriculaLogin] createUser:", created.error.message);
          return { ok: false as const, reason: "server" as const };
        }
        const retry = await withTimeout(
          supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email }),
          8000,
          "generate-link-retry",
        );
        hashedToken = retry.data?.properties?.hashed_token;
        if (!hashedToken) return { ok: false as const, reason: "server" as const };
      }

      return { ok: true as const, tokenHash: hashedToken, enrollment };
    } catch (err) {
      console.error("[studentMatriculaLogin] critical:", err);
      const msg = err instanceof Error ? err.message : String(err ?? "");
      if (msg.startsWith("timeout:")) return { ok: false as const, reason: "timeout" as const };
      return { ok: false as const, reason: "server" as const };
    }
  });
