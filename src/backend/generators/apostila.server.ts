import { callAIText } from "../ai.server";
import { buildSystemPrompt } from "./shared-prompts.server";
import { stripPredefinedDates, stripApostilaSections } from "../ai-assistant-core.server";
import { buildStandardDocumentHeader } from "../ai-assistant-common.server";
import { normalizeApostilaMarkdown } from "@/lib/apostila-markdown";
import { z } from "zod";

const ApostilaInputSchema = z.object({
  prompt: z.string().min(1).max(30000),
  disciplineId: z.string().uuid(),
  courseOverride: z.string().max(200).optional(),
  teacherOverride: z.string().max(200).optional(),
});

export async function generateApostilaLogic(params: {
  prompt: string;
  disciplineId: string;
  courseOverride?: string;
  teacherOverride?: string;
}) {
  try {
    const validated = ApostilaInputSchema.parse(params);
    const systemPrompt = buildSystemPrompt("apostila");
    const rawResult = await callAIText({
      system: systemPrompt,
      user: validated.prompt,
      model: "google/gemini-2.5-flash"
    });
    
    if (!rawResult) throw new Error("A IA retornou uma resposta vazia.");
    
    let sanitized = stripPredefinedDates(rawResult);
    sanitized = stripApostilaSections(sanitized);
    sanitized = normalizeApostilaMarkdown(sanitized);
    
    const header = await buildStandardDocumentHeader(validated.disciplineId, {
      docLabel: "Material Didático (Apostila)",
      courseOverride: validated.courseOverride,
      teacherOverride: validated.teacherOverride,
    });
    
    return normalizeApostilaMarkdown(header + sanitized);
  } catch (error) {
    console.error("[generateApostilaLogic] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    return `### Erro na Geração da Apostila\n\nNão foi possível gerar o conteúdo: ${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}
