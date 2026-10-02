import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const checkPedagogicalSymmetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({
    discipline_id: z.string().uuid(),
    tool: z.string(),
    parent_id: z.string().uuid().optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    // 1. Check if discipline exists
    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("id")
      .eq("id", data.discipline_id)
      .maybeSingle();
    
    if (!disc) return { status: "not_found", message: "Disciplina não encontrada." };

    // 2. Logic for Lesson Plan -> Apostila
    if (data.tool === "apostila") {
      const { data: plan } = await supabaseAdmin
        .from("ai_generations")
        .select("id")
        .eq("discipline_id", data.discipline_id)
        .eq("tool", "lesson_plan")
        .maybeSingle();
      
      if (!plan) {
        return {
          status: "warning",
          message: "Recomendamos criar ou selecionar o Plano de Aula deste módulo primeiro para garantir a sincronia dos conteúdos."
        };
      }
    }

    // 3. Logic for Apostila -> Others (Slides, Exercises, Assessments)
    const downstreamTools = ["slides", "exercise_list", "quiz"];
    if (downstreamTools.includes(data.tool)) {
      if (!data.parent_id) {
         // Check if at least one apostila exists in the discipline
         const { data: apostilas } = await supabaseAdmin
           .from("ai_generations")
           .select("id")
           .eq("discipline_id", data.discipline_id)
           .eq("tool", "apostila")
           .limit(1);
         
         if (!apostilas || apostilas.length === 0) {
           return {
             status: "warning",
             message: "Recomendamos criar ou selecionar o Plano de Aula/Apostila deste módulo primeiro para garantir a sincronia dos conteúdos."
           };
         }
      }
    }

    return { status: "ok" };
  });
