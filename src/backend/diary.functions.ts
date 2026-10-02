import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const saveDiaryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    id: z.string().uuid().optional(),
    discipline_id: z.string().uuid(),
    session_id: z.string().uuid().optional().nullable(),
    title: z.string().trim().max(160).optional(),
    content: z.string().trim().max(50000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    // Confirm enrollment.
    const { data: enroll } = await supabaseAdmin
      .from("discipline_students").select("id")
      .eq("discipline_id", data.discipline_id).eq("student_id", context.userId).maybeSingle();
    if (!enroll) throw new Error("Você não está matriculado nesta disciplina");

    if (data.id) {
      const { error } = await supabaseAdmin.from("student_diary_entries").update({
        title: data.title ?? null,
        content: data.content,
        session_id: data.session_id ?? null,
      }).eq("id", data.id).eq("student_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin.from("student_diary_entries").insert({
      student_id: context.userId,
      discipline_id: data.discipline_id,
      session_id: data.session_id ?? null,
      title: data.title ?? null,
      content: data.content,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteDiaryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await supabaseAdmin.from("student_diary_entries")
      .delete().eq("id", data.id).eq("student_id", context.userId);
    return { ok: true };
  });
