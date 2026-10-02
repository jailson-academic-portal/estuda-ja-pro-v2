// Server-only helper for Lovable AI Gateway calls.
import { extractAIContent } from "@/lib/ai-content";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_IMAGE_URL = "https://ai.gateway.lovable.dev/v1/images/generations";

/**
 * Generates a single image via the Lovable AI Gateway (non-streaming) and
 * returns it as raw bytes. Used for slide background images.
 */
export async function callAIImage(opts: {
  prompt: string;
  model?: string;
  size?: string;
  timeoutMs?: number;
}): Promise<Uint8Array> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");
  const res = await fetch(GATEWAY_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "openai/gpt-image-1-mini",
      prompt: opts.prompt,
      size: opts.size ?? "1536x1024",
      quality: "low",
      n: 1,
    }),
  });
  if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
  if (res.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Configurações.");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha na geração de imagem (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new Error("Imagem não retornada pela IA");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Alguns modelos devolvem markdown com "\n" escapado. Convertemos para quebras
 * reais, EXCETO quando a resposta é um JSON (objeto/array): nesse caso o "\n"
 * escapado faz parte da string JSON e desescapá-lo quebraria o JSON.parse.
 */
function unescapeLiteralNewlines(text: string): string {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return text;
  return text.replace(/\\n/g, "\n");
}

export async function callAIText(opts: {
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** Tentativas extras quando o modelo devolve conteúdo vazio (default: 2). */
  retries?: number;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");
  const attempts = Math.max(1, (opts.retries ?? 2) + 1);
  let last = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        // Acima de ~16k tokens alguns modelos devolvem conteúdo vazio.
        max_tokens: Math.min(opts.maxTokens ?? 16000, 16000),
        temperature: opts.temperature ?? 0.7,
      }),
    });
    if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Configurações.");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Falha na IA (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const choice = json.choices?.[0];
    const raw = choice?.message?.content;
    const text = unescapeLiteralNewlines(
      extractAIContent(typeof raw === "string" ? raw : (raw ?? "")),
    );
    if (text.trim().length > 0) return text;
    last = text;
    console.warn(
      `[callAIText] resposta vazia (tentativa ${attempt + 1}/${attempts})`,
      choice?.finish_reason ?? "sem finish_reason",
    );
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }

  return last;
}


export async function callAIJson<T = unknown>(opts: {
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 16000,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
  if (res.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Configurações.");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha na IA (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return parseAIJson<T>(content);
}

function parseAIJson<T>(raw: string): T {
  // Fast path
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }

  // Strip markdown code fences and surrounding prose
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Find JSON boundaries (object or array)
  const start = cleaned.search(/[\{\[]/);
  if (start !== -1) {
    const openChar = cleaned[start];
    const closeChar = openChar === "[" ? "]" : "}";
    const end = cleaned.lastIndexOf(closeChar);
    if (end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }

  // Common cleanup for LLM responses
  cleaned = cleaned
    .replace(/,\s*([}\]])/g, "$1") // Trailing commas
    .replace(/[\x00-\x1F\x7F]/g, ""); // Control characters

  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error("AI JSON Parse Error:", e);
    console.error("Raw content:", raw);
    console.error("Cleaned content:", cleaned);

    // Final attempt: aggressive regex cleanup for common hallucinations
    try {
      // 1. Fix unescaped newlines inside quotes
      // 2. Fix literal tabs/controls
      // 3. Fix simple missing quotes on keys (very common with some models)
      let aggressive = cleaned
        .replace(/(\w+)\s*:/g, '"$1":') // Ensure keys are quoted (simple word keys)
        .replace(/:"\s*(.*?)\s*"\s*(,|})/g, (match, p1, p2) => {
           // Fix unescaped newlines in string values
           return ':"' + p1.replace(/\n/g, "\\n") + '"' + p2;
        });

      // Special case: if it looks like it's just raw text, wrap it or fail
      if (!aggressive.startsWith("{") && !aggressive.startsWith("[")) {
        throw new Error("Not a JSON structure");
      }

      return JSON.parse(aggressive) as T;
    } catch {
      // Log the failed aggressive cleanup too
      console.error("Aggressive cleanup failed for:", cleaned);
      throw new Error("Resposta da IA não é JSON válido");
    }
  }
}

export async function callAIVisionText(opts: {
  system: string;
  user: string;
  imageDataUrl: string;
  model?: string;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: opts.system },
        {
          role: "user",
          content: [
            { type: "text", text: opts.user },
            { type: "image_url", image_url: { url: opts.imageDataUrl } },
          ],
        },
      ],
      max_tokens: 8000,
    }),
  });
  if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
  if (res.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Configurações.");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha na IA (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  return extractAIContent(json.choices?.[0]?.message?.content ?? "").replace(/\\n/g, "\n");
}