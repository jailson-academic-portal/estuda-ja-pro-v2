import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Checks whether an enrollment number (matrícula) is authorized to create an
 * account. This endpoint is necessarily unauthenticated (it runs before the
 * account exists), so it MUST NOT return any personal data.
 *
 * SECURITY: the response is a boolean only. Returning the student's real name,
 * status or any other profile field here would let anyone on the internet
 * enumerate short, predictable enrollment numbers and harvest PII. The real
 * name is resolved server-side after authentication (syncStudentProfile).
 */
export const validateEnrollment = createServerFn({ method: "POST" })
  .validator((d: { matricula: string }) =>
    z
      .object({
        matricula: z
          .string()
          .trim()
          .min(3)
          .max(20)
          .regex(/^[A-Za-z]{2}\d{1,9}$/, "Formato de matrícula inválido"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const cleanMatricula = data.matricula.trim();

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, password_set")
        .ilike("enrollment_number", cleanMatricula)
        .maybeSingle();

      if (error) {
        console.error("[validateEnrollment] Database error:", error.message);
        // Do not leak internal error details to the client.
        return { authorized: false as const };
      }

      if (!profile) return { authorized: false as const };

      // Accounts that already have a password must sign in, not sign up again.
      if (profile.password_set) return { authorized: false as const, alreadyRegistered: true };

      return { authorized: true as const };
    } catch (err) {
      console.error("[validateEnrollment] Critical error:", err);
      return { authorized: false as const };
    }
  });
