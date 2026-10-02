import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeAITitle } from "@/lib/text-sanitize";

/**
 * Sugere UM único título de caso clínico direto (sem saudações nem listas)
 * para o campo "Tema do Caso Clínico (SimulSaúde)" no Plano de Aula.
 */
export const suggestClinicalCaseTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ topic: z.string().trim().min(2).max(30000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { callAIText } = await import("./ai.server");
    const raw = await callAIText({
      system: `Você é um especialista em simulação clínica e educação em saúde.
Sua ÚNICA saída é um JSON válido no formato: {"titulo":"<título do caso clínico>"}.
REGRAS ABSOLUTAS:
1. Retorne EXATAMENTE 1 título, clínico, específico e contextualizado (ex: "Diagnóstico Diferencial de Arboviroses em Paciente com Febre e Exantema").
2. PROIBIDO: saudações, introduções ("Aqui estão..."), listas, numeração, markdown, explicações ou qualquer texto fora do JSON.
3. Máximo de 160 caracteres, sem ponto final.`,
      user: `Gere o título de 1 caso clínico para: ${data.topic}`,
      temperature: 0.6,
      maxTokens: 300,
    });

    let candidate = "";
    try {
      const parsed = JSON.parse(
        String(raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(),
      );
      candidate = String(parsed?.titulo ?? parsed?.title ?? "");
    } catch {
      candidate = String(raw ?? "");
    }

    const title = sanitizeAITitle(candidate, 200);
    return { title };
  });
