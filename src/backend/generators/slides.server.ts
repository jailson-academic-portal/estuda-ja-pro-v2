import { callAIText } from "../ai.server";
import { buildSystemPrompt } from "./shared-prompts.server";
import { stripPredefinedDates } from "../ai-assistant-core.server";
import { z } from "zod";

const SlidesInputSchema = z.object({
  prompt: z.string().min(1).max(30000),
});

/** Schema do slide retornado pela IA em JSON */
const SlideSchema = z.object({
  tipo: z.enum(["Capa", "Conteúdo", "Encerramento"]),
  titulo: z.string(),
  bullets: z.array(z.string()),
  exemploPratico: z.array(z.string()).nullable(),
  notasProfessor: z.array(z.string()),
  imageUrl: z.string().nullable(),
});

const SlidesResponseSchema = z.object({
  slides: z.array(SlideSchema),
});

/**
 * Converte o JSON de slides de volta para markdown formatado.
 * O campo imageUrl é incluído como:
 * 1. Linha especial "Imagem: ..." no final do slide (para compatibilidade com regex)
 * 2. Metadado JSON no início do slide (para parsing estruturado)
 */
function jsonToMarkdown(slides: z.infer<typeof SlideSchema>[]): string {
  return slides.map((slide, index) => {
    const lines: string[] = [];
    // Metadado estruturado para parsing fácil (será removido na renderização)
    const imageUrlMeta = slide.tipo === "Conteúdo" && slide.imageUrl
      ? `\n<!-- imageUrl:${slide.imageUrl} -->\n`
      : "";

    lines.push(`SLIDE ${index + 1}:${imageUrlMeta}`);
    lines.push(`Tipo de Slide: ${slide.tipo}`);
    lines.push(`Título do Slide: ${slide.titulo}`);
    lines.push("Conteúdo Principal:");
    for (const bullet of slide.bullets) {
      lines.push(`- ${bullet}`);
    }
    if (slide.exemploPratico && slide.exemploPratico.length > 0) {
      lines.push("Exemplo Prático:");
      for (const exemplo of slide.exemploPratico) {
        lines.push(`- ${exemplo}`);
      }
    }
    lines.push("Notas do Professor:");
    for (const nota of slide.notasProfessor) {
      lines.push(`- ${nota}`);
    }
    // Linha de imagem para slides de conteúdo (mantém formato antigo para regex)
    if (slide.tipo === "Conteúdo" && slide.imageUrl) {
      lines.push("");
      lines.push(`Imagem: ${slide.imageUrl}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

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

    // Tenta parsear como JSON primeiro
    let markdown: string;
    try {
      // Extrai apenas o JSON da resposta (remove markdown code blocks se houver)
      const jsonText = rawResult
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = SlidesResponseSchema.parse(JSON.parse(jsonText));
      markdown = jsonToMarkdown(parsed.slides);
    } catch (jsonError) {
      // Se falhar, usa o texto raw como fallback
      console.warn("[generateSlidesLogic] JSON parse failed, using raw text:", jsonError);
      markdown = rawResult;
    }

    return stripPredefinedDates(markdown);
  } catch (error) {
    console.error("[generateSlidesLogic] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    return `### Erro na Geração dos Slides\n\n${error instanceof Error ? error.message : "Erro desconhecido"}`;
  }
}
