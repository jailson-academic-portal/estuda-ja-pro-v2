const PREFERRED_CONTENT_KEYS = [
  "content",
  "markdown",
  "text",
  "answer",
  "response",
  "output",
  "result",
  "message",
  "value",
] as const;

const NON_TEXT_KEYS = new Set([
  "image",
  "images",
  "image_url",
  "image_urls",
  "url",
  "urls",
  "file",
  "files",
  "audio",
  "video",
  "metadata",
  "usage",
  "id",
  "model",
  "finish_reason",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractFromArray(values: unknown[]): string {
  const parts = values
    .map((value) => extractAIContent(value))
    .map((value) => value.trim())
    .filter(Boolean);

  return parts.join("\n");
}

function extractFromObject(value: Record<string, unknown>): string {
  for (const key of PREFERRED_CONTENT_KEYS) {
    if (!(key in value)) continue;
    const extracted = extractAIContent(value[key]).trim();
    if (extracted) return extracted;
  }

  const textualParts: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (NON_TEXT_KEYS.has(key.toLowerCase())) continue;

    if (typeof child === "string" && child.trim()) {
      textualParts.push(child.trim());
      continue;
    }

    if (Array.isArray(child)) {
      const extracted = extractFromArray(child);
      if (extracted) textualParts.push(extracted);
    }
  }

  return textualParts.join("\n");
}

/**
 * Extrai somente o conteúdo textual útil de respostas da IA.
 *
 * Respostas multimodais e respostas de gateways podem conter, no mesmo
 * objeto, texto, imagens, URLs, metadados e identificadores. Não é seguro
 * escolher simplesmente o primeiro campo string, pois isso pode exibir um
 * título, uma URL de imagem ou um campo auxiliar no lugar da resposta pedida.
 */
export function extractAIContent(response: unknown): string {
  try {
    if (typeof response === "string") {
      const trimmed = response.trim();
      if (!trimmed) return "";

      const startsLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
      if (startsLikeJson) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const extracted = extractAIContent(parsed);
          return extracted || response;
        } catch {
          return response;
        }
      }

      return response;
    }

    if (Array.isArray(response)) {
      return extractFromArray(response);
    }

    if (isRecord(response)) {
      return extractFromObject(response);
    }

    return response == null ? "" : String(response);
  } catch {
    try {
      return response == null ? "" : String(response);
    } catch {
      return "";
    }
  }
}

export function normalizeAIContent(response: unknown): string {
  return extractAIContent(response)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .trim();
}

/**
 * Extrai o número do módulo (e, quando houver, da aula) a partir de um título
 * de documento, ex.: "Apostila - Módulo 3: Aula 2: Tema" -> { modulo: 3, aula: 2 }.
 * Documentos sem módulo recebem Infinity para ficarem no fim da lista.
 */
export function extractModuleOrder(title: string | null | undefined): { modulo: number; aula: number } {
  const t = title ?? "";
  const modMatch = t.match(/m[óo]dulo\s*0*(\d+)/i);
  const aulaMatch = t.match(/aula\s*0*(\d+)/i);
  return {
    modulo: modMatch ? parseInt(modMatch[1], 10) : Number.POSITIVE_INFINITY,
    aula: aulaMatch ? parseInt(aulaMatch[1], 10) : Number.POSITIVE_INFINITY,
  };
}

/**
 * Comparador para ordenar documentos por Módulo (e Aula) em ordem crescente.
 * Itens sem módulo caem para o final, ordenados por `created_at` (mais recente primeiro).
 * Use com `.sort()` em listas de apostilas, slides, planos de aula e outros documentos.
 */
export function compareByModuleOrder(
  a: { title?: string | null; created_at?: string | null },
  b: { title?: string | null; created_at?: string | null },
): number {
  const oa = extractModuleOrder(a.title);
  const ob = extractModuleOrder(b.title);
  if (oa.modulo !== ob.modulo) return oa.modulo - ob.modulo;
  if (oa.aula !== ob.aula) return oa.aula - ob.aula;
  // Sem módulo definido em ambos: mais recentes primeiro.
  const ta = a.created_at ? Date.parse(a.created_at) : 0;
  const tb = b.created_at ? Date.parse(b.created_at) : 0;
  return tb - ta;
}

/**
 * Deriva o nome padronizado de uma apresentação de slides no formato
 * "Módulo [N]: Aula [N]: [Tema]" a partir do slide "Capa" gerado pela IA.
 * Retorna null quando não é possível identificar módulo/aula/tema.
 */
export function deriveSlidesTitle(markdown: string): string | null {
  if (!markdown) return null;
  const blocks = markdown
    .split(/^\s*SLIDE\s+\d+\s*:\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);
  const capa = blocks.find((b) => /^Tipo de Slide\s*:\s*Capa/im.test(b)) ?? blocks[0];
  if (!capa) return null;
  const modLine = capa.match(/^\s*[-*•]?\s*M[óo]dulo\s*:\s*(.+)$/im)?.[1]?.trim();
  const aulaLine = capa.match(/^\s*[-*•]?\s*Aula\s*:\s*(.+)$/im)?.[1]?.trim();
  if (!modLine || !aulaLine) return null;
  const modNum = modLine.match(/(\d+)/)?.[1];
  const aulaMatch = aulaLine.match(/^\s*(?:Aula\s*)?(\d+)\s*[-–—:.)]?\s*(.*)$/i);
  const aulaNum = aulaMatch?.[1];
  let theme = (aulaMatch?.[2] ?? "").trim();
  if (!theme) theme = aulaLine.replace(/^\s*(?:Aula\s*)?\d+\s*[-–—:.)]?\s*/i, "").trim();
  if (!modNum || !aulaNum || !theme) return null;
  return `Módulo ${modNum}: Aula ${aulaNum}: ${theme}`;
}
