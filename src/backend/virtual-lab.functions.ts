import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { callAIJson } from "./ai.server";

export const LAB_MODULE_LABELS: Record<string, string> = {
  biosseguranca: "Biossegurança",
  pre_analitica: "Pré-analítica",
  hematologia: "Hematologia",
  urinalise_fisica_quimica: "Urinálise Física/Química",
  urinalise_microscopica: "Urinálise Microscópica",
  microbiologia: "Microbiologia",
  bioquímica: "Bioquímica",
  mega_caso_integrador: "Mega-caso Integrador",
};

export const getLabConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ disciplineId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: config, error } = await supabaseAdmin
      .from("discipline_lab_config")
      .select("*")
      .eq("discipline_id", data.disciplineId);
    
    if (error) throw error;
    return config || [];
  });

export const updateLabModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    disciplineId: z.string().uuid(),
    moduleType: z.string(),
    isActive: z.boolean(),
    customMedia: z.array(z.any()).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);
    
    const { error } = await supabaseAdmin
      .from("discipline_lab_config")
      .upsert({
        discipline_id: data.disciplineId,
        module_type: data.moduleType as any,
        is_active: data.isActive,
        custom_media: data.customMedia || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: "discipline_id,module_type" });

    if (error) throw error;
    return { ok: true };
  });

export const generateLabCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    disciplineId: z.string().uuid(),
    moduleType: z.string(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const moduleLabel = LAB_MODULE_LABELS[data.moduleType] || data.moduleType;

    const system = `Você é um instrutor de laboratório especializado em análises clínicas.
    Gere um caso simulado prático e realista para o módulo de "${moduleLabel}".
    O enredo deve ser dinâmico, com personagens, acidentes e situações técnicas variadas.

    IMPORTANTE: Organize o enunciado obrigatoriamente em três seções identificadas por marcadores específicos no texto:
    1. [CONTEXTO]: Descreva o ambiente, o profissional e o paciente.
    2. [OCORRENCIA]: Descreva o incidente, erro de biossegurança ou achado clínico principal.
    3. [DADOS_TECNICOS]: Descreva os procedimentos, equipamentos e conduta técnica.

    REGRAS:
    1. Retorne APENAS um objeto JSON válido.
    2. O enredo deve ser detalhado e técnico.
    3. Inclua uma sugestão de URL de imagem realista (Unsplash/Pexels) relacionada ao tema.
    4. Gere de 2 a 3 perguntas técnicas sobre a conduta ou interpretação do caso.

    FORMATO DO JSON:
    {
      "title": "Título Criativo do Caso",
      "content": "[CONTEXTO]\nTexto do contexto...\n\n[OCORRENCIA]\nTexto da ocorrência...\n\n[DADOS_TECNICOS]\nTexto dos dados técnicos...",
      "image_suggestion": "https://images.unsplash.com/photo-...",
      "questions": [
        { "question": "Pergunta 1?" },
        { "question": "Pergunta 2?" }
      ]
    }`;

    const seed = `time-${Date.now()}-rand-${Math.random().toString(36).substring(7)}`;
    const prompt = `Crie um caso único e desafiador para o módulo de ${moduleLabel}. Seed: ${seed}`;

    const aiResponse = await callAIJson<any>({ system, user: prompt });

    const { data: simulation, error } = await supabaseAdmin
      .from("discipline_lab_simulations")
      .insert({
        discipline_id: data.disciplineId,
        module_type: data.moduleType,
        title: aiResponse.title || `Caso de ${moduleLabel}`,
        content: aiResponse.content || "Enunciado não gerado.",
        questions: Array.isArray(aiResponse.questions) ? aiResponse.questions : [],
        image_url: aiResponse.image_suggestion || aiResponse.imageUrl || null,
        teacher_id: context.userId,
        is_draft: true
      } as any)
      .select()
      .single();

    if (error) throw error;
    return simulation;
  });

export const getLabSimulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ disciplineId: z.string().uuid(), moduleType: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { data: simulations, error } = await supabaseAdmin
      .from("discipline_lab_simulations")
      .select("*")
      .eq("discipline_id", data.disciplineId)
      .eq("module_type", data.moduleType)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return simulations || [];
  });

export const submitLabResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    simulationId: z.string().uuid(),
    answers: z.array(z.any()),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("discipline_lab_submissions")
      .insert({
        simulation_id: data.simulationId,
        student_id: context.userId,
        answers: data.answers
      });

    if (error) throw error;
    return { ok: true };
  });

export const gradeLabSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    submissionId: z.string().uuid(),
    grade: z.number(),
    feedback: z.string().optional(),
    diaryColumnId: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    // Permissão: Apenas professores podem dar nota.
    // Primeiro pegamos a simulação para saber a disciplina.
    const { data: sub } = await supabaseAdmin
      .from("discipline_lab_submissions")
      .select("simulation_id")
      .eq("id", data.submissionId)
      .single();
    
    if (!sub) throw new Error("Submissão não encontrada");

    const { data: sim } = await supabaseAdmin
      .from("discipline_lab_simulations")
      .select("discipline_id")
      .eq("id", sub.simulation_id)
      .single();

    if (!sim) throw new Error("Simulação não encontrada");

    await assertTeacherOrAdmin(sim.discipline_id, context.userId);

    const { error } = await supabaseAdmin
      .from("discipline_lab_submissions")
      .update({
        grade: data.grade,
        feedback: data.feedback,
        diary_column_id: data.diaryColumnId
      })
      .eq("id", data.submissionId);

    if (error) throw error;
    return { ok: true };
  });
