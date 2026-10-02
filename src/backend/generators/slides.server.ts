import { callAIText } from "../ai.server";
import { buildSystemPrompt } from "./shared-prompts.server";
import { stripPredefinedDates } from "../ai-assistant-core.server";
import { z } from "zod";

const SlidesInputSchema = z.object({
  prompt: z.string().min(1).max(30000),
});

export async function generateSlidesLogic(params: {
  prompt: string;
}) {
  try {
    const validated = SlidesInputSchema.parse(params);
    const systemPrompt = buildSystemPrompt("slides");
    const rawResult = await callAIText({
      system: systemPrompt,
      user: validated.prompt,
      model: "google/gemini-2.5-flash"
    });
    
    if (!rawResult) throw new Error("A IA retornou uma resposta vazia.");
    
    return stripPredefinedDates(rawResult);
  } catch (error) {
    console.error("[generateSlidesLogic] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    return `### Erro na Geração dos Slides\n\n${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}
