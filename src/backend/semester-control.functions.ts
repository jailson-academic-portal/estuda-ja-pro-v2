import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const closeSemester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ institution_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitution } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);
    if (instId !== data.institution_id) throw new Error("Acesso não autorizado");

    // Trava de fechamento: No EstudaJá Pro, isso poderia ser uma flag na tabela de turmas (school_classes)
    // ou na tabela de disciplinas. Vamos marcar todas as disciplinas da instituição como 'archived'.
    const { error } = await supabaseAdmin
      .from("disciplines")
      .update({ status: "archived" } as never)
      .eq("institution_id", instId)
      .eq("status", "active");

    if (error) throw new Error(error.message);
    return { ok: true };
  });
