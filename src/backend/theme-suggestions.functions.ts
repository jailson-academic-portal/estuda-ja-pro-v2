import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sugere temas curtos para trabalhos acadêmicos (uso do professor). */
export const suggestWorkThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ topic: z.string().trim().min(2).max(30000) })
      .parse(
        typeof (input as any)?.topic === "string"
          ? { ...(input as any), topic: String((input as any).topic).slice(0, 2000) }
          : input,
      ),
  )
  .handler(async ({ data }) => {
    const { callAIText } = await import("./ai.server");
    const text = await callAIText({
      system: "Você é um assistente acadêmico.",
      user: `Sugira 5 temas curtos e criativos para um trabalho acadêmico sobre: ${data.topic}. Responda apenas a lista em pt-BR, um por linha.`,
    });
    return { suggestions: text ?? "" };
  });
