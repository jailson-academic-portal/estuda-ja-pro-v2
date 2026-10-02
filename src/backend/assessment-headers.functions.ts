import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Modelos de cabeçalho EXCLUSIVOS das avaliações (folha de questões e folha de
 * respostas). Não afetam os demais documentos gerados pela plataforma.
 */

const templateSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(120),
  logo_url: z.string().url().nullable().optional(),
  logo_scale: z.number().min(0.5).max(2.5).default(1),
  banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#C8D400"),
  strip_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#E8323C"),
  unit_label: z.string().max(120).nullable().optional(),
  shift_label: z.string().max(60).nullable().optional(),
  instructions: z.string().max(30000).nullable().optional(),
  show_grade_box: z.boolean().default(true),
  compact_questions_header: z.boolean().default(true),
  exclusive_answer_sheet_rules: z.boolean().default(true),
});

export const DEFAULT_ASSESSMENT_INSTRUCTIONS = [
  "1. Leia com atenção, não esqueça o seu NOME e sua MATRÍCULA;",
  "2. É terminantemente proibido o uso do celular;",
  "3. Não peça nenhum material ao colega; a letra deve ser legível;",
  "4. Serão anuladas as questões: quando utilizado o uso de corretivo, respondidas com grafite, assinaladas em duas ou mais alternativas e rasuradas.",
].join("\n");

async function myInstitution(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("institution_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.institution_id ?? null;
}

/** Lista os modelos que o usuário pode usar (próprios + da instituição). */
export const listAssessmentHeaderTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const instId = await myInstitution(userId);
    const filter = instId
      ? `owner_user_id.eq.${userId},institution_id.eq.${instId}`
      : `owner_user_id.eq.${userId}`;
    const { data, error } = await supabaseAdmin
      .from("assessment_header_templates")
      .select("*")
      .or(filter)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []).map((t) => ({ ...t, can_edit: t.owner_user_id === userId })),
      default_instructions: DEFAULT_ASSESSMENT_INSTRUCTIONS,
    };
  });

/** Cria ou atualiza um modelo de cabeçalho de avaliação. */
export const saveAssessmentHeaderTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => templateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const instId = await myInstitution(userId);
    const payload = {
      owner_user_id: userId,
      institution_id: instId,
      name: data.name.trim(),
      logo_url: data.logo_url ?? null,
      logo_scale: data.logo_scale ?? 1,
      banner_color: data.banner_color,
      strip_color: data.strip_color,
      unit_label: data.unit_label?.trim() || null,
      shift_label: data.shift_label?.trim() || null,
      instructions: data.instructions?.trim() || DEFAULT_ASSESSMENT_INSTRUCTIONS,
      show_grade_box: data.show_grade_box,
      compact_questions_header: data.compact_questions_header,
      exclusive_answer_sheet_rules: data.exclusive_answer_sheet_rules,
    };
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("assessment_header_templates")
        .select("owner_user_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing || existing.owner_user_id !== userId) {
        throw new Error("Você não pode editar este modelo de cabeçalho.");
      }
      const { error } = await (supabaseAdmin
        .from("assessment_header_templates") as any)
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await (supabaseAdmin
      .from("assessment_header_templates") as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

/** Remove um modelo (apenas o dono). */
export const deleteAssessmentHeaderTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("assessment_header_templates")
      .delete()
      .eq("id", data.id)
      .eq("owner_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });