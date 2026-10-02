import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const saveExternalMaterial = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    module_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    category: z.enum(['Apostilas', 'Material Complementar', 'Artigos', 'Exercícios']),
    file_url: z.string().min(1),
    file_type: z.string().optional(),
}).parse(input))
    .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertTeacherOrAdmin } = await import("./discipline-access.server");
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("materials").insert({
        discipline_id: data.discipline_id,
        module_id: data.module_id,
        title: data.title,
        description: `Categoria: ${data.category}`,
        file_url: data.file_url,
        status: "published",
        created_by: context.userId,
        source: "external",
    });
    if (error)
        throw new Error(error.message);
    return { ok: true };
});
