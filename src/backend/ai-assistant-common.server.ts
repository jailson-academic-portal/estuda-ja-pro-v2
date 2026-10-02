import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Builds the standardized header block injected at the top of every
 * AI-generated document delivered to students (apostilas, atividades, trabalhos).
 * Sourced from disciplines + institutions + profiles.
 */
export async function buildStandardDocumentHeader(
  disciplineId: string,
  opts?: {
    docLabel?: string | null;
    docValue?: string | null;
    courseOverride?: string | null;
    teacherOverride?: string | null;
  },
): Promise<string> {
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("id, name, group_name, teacher_id, institution_id")
    .eq("id", disciplineId)
    .maybeSingle();
  if (!disc) return "";
  const { data: teacher } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", disc.teacher_id)
    .maybeSingle();
  const { resolveBrandingLogoUrl } = await import("./branding.server");
  const logoUrl = await resolveBrandingLogoUrl(disc.teacher_id);
  const course =
    opts?.courseOverride?.trim() || disc.group_name || "Não informado";
  const discipline = disc.name;
  const teacherOverride = opts?.teacherOverride?.trim();
  const teacherName =
    (teacherOverride && !/^estudaj[áa]\s*pro$/i.test(teacherOverride) ? teacherOverride : null) ||
    (teacher?.name && !/^estudaj[áa]\s*pro$/i.test(teacher.name) ? teacher.name : null) ||
    "Não informado";
  const lines: string[] = [];
  if (logoUrl) {
    lines.push(`![Logo](${logoUrl})`, "");
  }
  lines.push(`**Disciplina:** ${discipline}`);
  lines.push(`**Curso:** ${course}`);
  lines.push(`**Professor(a):** ${teacherName}`);
  // Dynamic identification line, specific to each document type.
  const docLabel = opts?.docLabel?.trim();
  const docValue = opts?.docValue?.trim();
  if (docLabel) {
    lines.push(docValue ? `**${docLabel}:** ${docValue}` : `**${docLabel}**`);
  }
  lines.push("", "---", "");
  return lines.join("\n");
}
