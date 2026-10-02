import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const KNOWN_BUCKETS = new Set(["submissions", "materials", "syllabi", "justifications"]);

function parseStoragePath(fileUrl: string): { bucket: string; path: string } {
  // Submissions are uploaded to the "submissions" bucket; file_url is the storage path
  // (e.g. "<userId>/<disciplineId>/<work_id>/<filename>"). Tolerate older records that
  // included the bucket name as the first segment.
  const m = fileUrl.match(/^([^/]+)\/(.+)$/);
  if (m && KNOWN_BUCKETS.has(m[1])) return { bucket: m[1], path: m[2] };
  return { bucket: "submissions", path: fileUrl };
}

function detectExt(path: string): string {
  const lower = path.toLowerCase();
  const m = lower.match(/\.([a-z0-9]+)(?:\?|$)/);
  return m ? m[1] : "";
}

async function fetchFileBytes(fileUrl: string): Promise<{ bytes: Uint8Array; ext: string }> {
  // Only accept internal storage paths. External http(s) URLs are rejected to
  // prevent SSRF: student-submitted file_url could otherwise point at internal
  // services or cloud metadata endpoints when the teacher extracts text.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(fileUrl)) {
    throw new Error("URL externa não é permitida para extração. Envie o arquivo pelo upload da plataforma.");
  }
  const parsed = parseStoragePath(fileUrl);
  const { data, error } = await supabaseAdmin.storage.from(parsed.bucket).download(parsed.path);
  if (error || !data) throw new Error(error?.message ?? "Falha ao baixar arquivo do storage.");
  const buf = new Uint8Array(await data.arrayBuffer());
  return { bytes: buf, ext: detectExt(parsed.path) };
}

export async function extractTextFromFile(fileUrl: string): Promise<string> {
  const { bytes, ext } = await fetchFileBytes(fileUrl);
  try {
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const out = Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
      return out.trim();
    }
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return (result.value ?? "").trim();
    }
    if (ext === "txt" || ext === "md" || ext === "rtf") {
      return new TextDecoder("utf-8").decode(bytes).trim();
    }
    throw new Error(`Formato .${ext || "desconhecido"} não suportado para extração automática. Use PDF, DOCX ou TXT.`);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error("Erro ao extrair o texto do arquivo.");
  }
}