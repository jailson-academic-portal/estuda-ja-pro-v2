import { callAIText } from "../ai.server";
import { buildSystemPrompt } from "./shared-prompts.server";
import { buildStandardDocumentHeader } from "../ai-assistant-common.server";
import { z } from "zod";

const CaseStudyInputSchema = z.object({
  prompt: z.string().min(1).max(30000),
  disciplineId: z.string().uuid(),
  courseOverride: z.string().max(200).optional(),
  teacherOverride: z.string().max(200).optional(),
});

const ActivityInputSchema = z.object({
  prompt: z.string().min(1).max(30000),
  disciplineId: z.string().uuid(),
  courseOverride: z.string().max(200).optional(),
  teacherOverride: z.string().max(200).optional(),
  docLabel: z.string().max(100).optional(),
});

export async function generateCaseStudyLogic(params: {
  prompt: string;
  disciplineId: string;
  courseOverride?: string;
  teacherOverride?: string;
}) {
  try {
    const validated = CaseStudyInputSchema.parse(params);
    const systemPrompt = buildSystemPrompt("case_study");
    const rawResult = await callAIText({
      system: systemPrompt,
      user: validated.prompt,
      model: "google/gemini-2.5-flash"
    });
    
    if (!rawResult) throw new Error("A IA retornou uma resposta vazia.");
    
    return rawResult;
  } catch (error) {
    console.error("[generateCaseStudyLogic] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    return `### Erro na Geração do Estudo de Caso\n\n${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}

export async function generateActivityLogic(params: {
  prompt: string;
  disciplineId: string;
  courseOverride?: string;
  teacherOverride?: string;
  docLabel?: string;
}) {
  try {
    const validated = ActivityInputSchema.parse(params);
    const systemPrompt = buildSystemPrompt("activity_syllabus");
    const rawResult = await callAIText({
      system: systemPrompt,
      user: validated.prompt,
      model: "google/gemini-2.5-flash"
    });
    
    if (!rawResult) throw new Error("A IA retornou uma resposta vazia.");
    
    const header = await buildStandardDocumentHeader(validated.disciplineId, {
      docLabel: validated.docLabel || "Atividade Acadêmica",
      courseOverride: validated.courseOverride,
      teacherOverride: validated.teacherOverride,
    });
    
    return header + rawResult;
  } catch (error) {
    console.error("[generateActivityLogic] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    return `### Erro na Geração da Atividade\n\n${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}
