import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface DisciplineContext {
  disciplineName: string;
  teacherName: string;
  institutionName: string;
}

/** Real names for the active discipline (never the generic word "Disciplina"). */
export async function loadDisciplineContext(disciplineId: string): Promise<DisciplineContext> {
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("name, institution_id, teacher_id")
    .eq("id", disciplineId)
    .maybeSingle();

  const [teacherRes, instRes] = await Promise.all([
    disc?.teacher_id
      ? supabaseAdmin.from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    disc?.institution_id
      ? supabaseAdmin.from("institutions").select("name").eq("id", disc.institution_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  return {
    disciplineName: disc?.name?.trim() || "",
    teacherName: teacherRes?.data?.name?.trim() || "",
    institutionName: instRes?.data?.name?.trim() || "",
  };
}

/** Markdown content of a stored generation (apostila / lesson plan). */
export async function loadGenerationMarkdown(id: string): Promise<{ title: string; markdown: string }> {
  const { data } = await supabaseAdmin
    .from("ai_generations")
    .select("title, result")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { title: "", markdown: "" };
  const md = typeof data.result === "string" ? data.result : JSON.stringify(data.result ?? "");
  return { title: data.title ?? "", markdown: md };
}

/** Extracts the section of an apostila matching a lesson/module label. */
export function sliceMarkdownByLabel(markdown: string, label?: string): string {
  if (!markdown) return "";
  if (!label) return markdown.slice(0, 18000);
  const idx = markdown.toLowerCase().indexOf(label.toLowerCase());
  if (idx < 0) return markdown.slice(0, 18000);
  return markdown.slice(idx, idx + 18000);
}

export async function saveGeneration(params: {
  userId: string;
  disciplineId: string;
  tool: string;
  title: string;
  prompt: unknown;
  result: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_generations")
    .insert({
      user_id: params.userId,
      discipline_id: params.disciplineId,
      tool: params.tool,
      title: params.title.slice(0, 200),
      prompt: params.prompt as any,
      result: params.result as any,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
