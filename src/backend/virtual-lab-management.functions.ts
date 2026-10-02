import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

export const updateLabSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    simulationId: z.string().optional(),
    title: z.string(),
    content: z.string(),
    questions: z.array(z.any()),
    isDraft: z.boolean().default(false).optional(),
    deadline: z.string().optional().nullable(),
    lateRule: z.string().optional().nullable(),
    diaryColumnId: z.string().optional().nullable(),
    imageUrl: z.string().optional().nullable(),
    disciplineId: z.string().uuid().optional(),
    moduleType: z.string().optional(),
    status: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    let disciplineId = data.disciplineId;

    if (data.simulationId) {
      const { data: sim } = await supabaseAdmin
        .from("discipline_lab_simulations")
        .select("discipline_id")
        .eq("id", data.simulationId)
        .single();

      if (!sim) throw new Error("Simulação não encontrada");
      disciplineId = sim.discipline_id;
    }

    if (!disciplineId) throw new Error("ID da disciplina é obrigatório para novos casos");
    await assertTeacherOrAdmin(disciplineId, context.userId);

    const payload = {
      title: data.title,
      content: data.content,
      questions: Array.isArray(data.questions) ? data.questions : [],
      is_draft: data.isDraft,
      deadline: data.deadline && data.deadline.trim() !== "" ? data.deadline : null,
      late_rule: data.lateRule && data.lateRule.trim() !== "" ? data.lateRule : null,
      diary_column_id: data.diaryColumnId && data.diaryColumnId.trim() !== "" ? data.diaryColumnId : null,
      image_url: data.imageUrl && data.imageUrl.trim() !== "" ? data.imageUrl : null,
      discipline_id: disciplineId,
      module_type: data.moduleType || 'geral',
      teacher_id: context.userId,
    };

    const query = data.simulationId 
      ? supabaseAdmin.from("discipline_lab_simulations").update(payload).eq("id", data.simulationId)
      : supabaseAdmin.from("discipline_lab_simulations").insert(payload).select().single();

    const { data: result, error } = await query;

    if (error) {
      console.error("Erro ao salvar simulação:", error);
      throw new Error(`Erro ao salvar alterações: ${error.message}`);
    }
    return result || { ok: true };
  });

export const getLabSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ simulationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: submissions, error } = await supabaseAdmin
      .from("discipline_lab_submissions")
      .select(`
        *,
        profiles:student_id!inner (
          full_name,
          matricula
        )
      `)
      .eq("simulation_id", data.simulationId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return submissions || [];
  });

export const deleteLabSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ simulationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sim } = await supabaseAdmin
      .from("discipline_lab_simulations")
      .select("discipline_id")
      .eq("id", data.simulationId)
      .single();

    if (!sim) throw new Error("Simulação não encontrada");
    await assertTeacherOrAdmin(sim.discipline_id, context.userId);

    const { error } = await supabaseAdmin
      .from("discipline_lab_simulations")
      .delete()
      .eq("id", data.simulationId);

    if (error) throw error;
    return { ok: true };
  });
