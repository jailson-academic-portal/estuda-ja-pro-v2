import { callAIText } from "../ai.server";
import { buildSystemPrompt } from "./shared-prompts.server";
import { normalizeAssessmentMaterialOutput } from "../ai-assistant-core.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { outputHasMetaOptions, metaOptionRetryReinforcement } from "@/lib/question-quality";
import { z } from "zod";

const AssessmentInputSchema = z.object({
  tool: z.enum(["exercise_list", "quiz"]),
  prompt: z.string().min(1).max(30000),
  disciplineId: z.string().uuid(),
  courseOverride: z.string().max(500).optional(),
  teacherOverride: z.string().max(500).optional(),
  materialTitle: z.string().max(500).optional(),
  modules: z.array(z.string().max(1000)).optional(),
  themes: z.array(z.string().max(1000)).optional(),
});

export async function generateAssessmentLogic(params: {
  tool: "exercise_list" | "quiz";
  prompt: string;
  disciplineId: string;
  courseOverride?: string;
  teacherOverride?: string;
  materialTitle?: string;
  modules?: string[];
  themes?: string[];
}) {
  try {
    // Conteúdos de apostila podem estourar o limite do schema; recortamos o
    // prompt antes de validar para não invalidar a requisição inteira.
    const MAX_PROMPT = 30000;
    const rawPrompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
    const safePrompt = rawPrompt.length > MAX_PROMPT ? rawPrompt.slice(0, MAX_PROMPT) : rawPrompt;
    const validated = AssessmentInputSchema.parse({
      ...params,
      prompt: safePrompt,
      courseOverride: params.courseOverride?.slice(0, 500),
      teacherOverride: params.teacherOverride?.slice(0, 500),
      materialTitle: params.materialTitle?.slice(0, 500),
    });
    const systemPrompt = buildSystemPrompt(validated.tool) + "\n\nINSTRUÇÃO RIGOROSA DE CONCISÃO: Todas as questões, textos de apoio e alternativas devem ter no máximo 150 caracteres cada.";
    let rawResult = await callAIText({
      system: systemPrompt,
      user: validated.prompt,
      model: "google/gemini-2.5-flash"
    });

    // VALIDADOR DE QUALIDADE: se a saída contiver meta-opções, regenera uma
    // única vez com reforço explícito exigindo afirmações concretas.
    if (rawResult && outputHasMetaOptions(rawResult)) {
      const retry = await callAIText({
        system: `${systemPrompt}\n\n${metaOptionRetryReinforcement()}`,
        user: validated.prompt,
        model: "google/gemini-2.5-flash"
      });
      if (retry) rawResult = retry;
    }

    if (!rawResult) throw new Error("A IA retornou uma resposta vazia.");
    
    // Truncamento preventivo (Workaround para erro too_big no schema interno)
    try {
      let cleanJson = rawResult.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
      const start = cleanJson.search(/[\{\[]/);
      if (start !== -1) {
        const closeChar = cleanJson[start] === "[" ? "]" : "}";
        const end = cleanJson.lastIndexOf(closeChar);
        if (end > start) cleanJson = cleanJson.slice(start, end + 1);
      }
      const parsed = JSON.parse(cleanJson);
      let changed = false;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.title === "string") {
          parsed.title = parsed.title.substring(0, 500);
          changed = true;
        }
        if (Array.isArray(parsed.topics)) {
          parsed.topics = parsed.topics.map((t: any) => typeof t === "string" ? t.substring(0, 1000) : t);
          changed = true;
        }
      }
      if (changed) {
        rawResult = JSON.stringify(parsed);
      }
    } catch (e) {
      // Se não for JSON ou falhar no parse, segue o fluxo
    }
    
    // Fetch metadata for normalization
    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("name, institution_id, teacher_id")
      .eq("id", validated.disciplineId)
      .single();
      
    const { data: teacher } = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("id", disc?.teacher_id || "")
      .single();

    const { data: inst } = await supabaseAdmin
      .from("institutions")
      .select("name")
      .eq("id", disc?.institution_id || "")
      .single();

    const normalized = normalizeAssessmentMaterialOutput(rawResult, {
      institutionName: inst?.name || "Não informado",
      disciplineName: disc?.name || "Não informado",
      teacherName: validated.teacherOverride || teacher?.name || "Não informado",
      modules: validated.modules || [],
      themes: validated.themes || [],
      materialTitle: validated.materialTitle || (validated.tool === "quiz" ? "Avaliação" : "Lista de Exercícios")
    });
    
    return normalized;
  } catch (error) {
    console.error("[generateAssessmentLogic] Error:", error);
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((i) => `${i.path.join(".") || "campo"}: ${i.message}`).join("; ");
      throw new Error(`Parâmetros de entrada inválidos (${detail}).`);
    }
    return `### Erro na Geração da Avaliação\n\n${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}
