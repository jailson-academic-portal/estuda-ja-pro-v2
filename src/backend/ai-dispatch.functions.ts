import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents } from "./notifications.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { buildGenerationPPTX, buildGenerationSlidesPDF } from "./ai-export.functions";
import { resolveBrandingLogoUrl } from "./branding.server";
import { normalizeAIContent } from "@/lib/ai-content";
import { ensureLessonPlanStandardHeader } from "@/lib/lesson-plan-markdown";

const ACTIVITY_SUBTYPES = [
  "case_study", "care_plan", "pharmaceutical_plan", "practical_report", "free_activity",
  "redacao", "seminario", "debate", "visita_tecnica", "aula_pratica", "workshop",
] as const;

const WORK_SUBTYPES = [
  "tcc", "artigo_cientifico", "revisao_literatura", "estudo_caso_academico",
  "projeto_intervencao", "relatorio_pesquisa", "resumo_expandido",
  "poster_cientifico", "tema_predefinido",
] as const;

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

async function buildHeader(disciplineId: string): Promise<string> {
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("name, group_name, teacher_id, institution_id")
    .eq("id", disciplineId).maybeSingle();
  if (!disc) return "";
  const { data: teacher } = await supabaseAdmin
    .from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle();
  const lines: string[] = [];
  if (disc.group_name) lines.push(`**Curso:** ${disc.group_name}`);
  lines.push(`**Disciplina:** ${disc.name}`);
  if (teacher?.name) lines.push(`**Professor(a):** ${teacher.name}`);
  if (lines.length === 0) return "";
  return lines.join("  \n") + "\n\n---\n\n";
}

/**
 * Pega o conteúdo Markdown de uma geração de IA e cria a entidade real
 * que o aluno vai ver:
 *  - target=activity      → linha em `activities` (Atividade Extra)
 *  - target=academic_work → linha em `academic_works` (Trabalho Acadêmico)
 *  - target=material      → linha em `materials` (Materiais Didáticos)
 * O cabeçalho institucional é embutido no início do conteúdo.
 */
export const dispatchAIToStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    generation_id: z.string().uuid(),
    target: z.enum(["activity", "academic_work", "material"]),
    title: z.string().trim().min(1).max(200),
    content_markdown: z.string().min(1).max(200000),
    publish: z.boolean().default(true),
    // activity / work
    activity_subtype: z.enum(ACTIVITY_SUBTYPES).optional(),
    work_subtype: z.enum(WORK_SUBTYPES).optional(),
    due_at: z.string().nullable().optional(),
    // material
    module_id: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: gen } = await supabaseAdmin
      .from("ai_generations").select("user_id, discipline_id, tool, title, result, prompt")
      .eq("id", data.generation_id).maybeSingle();
    if (!gen) throw new Error("Geração não encontrada");
    if (gen.user_id !== context.userId) throw new Error("Sem permissão");
    if (!gen.discipline_id) throw new Error("Disciplina não vinculada à geração");
    await assertTeacher(gen.discipline_id, context.userId);

    // Build the body so it is IDENTICAL to what the teacher gets. Lesson plans
    // are normalized through the same standardizer (logo + Curso/Disciplina/
    // Professor, no "Instituição", no "Data" column). Documents that already
    // carry a standardized header are stored as-is to avoid a duplicated header;
    // only plain content gets the fallback institutional header prepended.
    let bodyContent = normalizeAIContent(data.content_markdown).trim();
    const hasStandardHeader = /\*\*Disciplina:\*\*/.test(bodyContent.slice(0, 800));
    if (gen.tool === "lesson_plan") {
      const logoUrl = await resolveBrandingLogoUrl(context.userId).catch(() => null);
      bodyContent = ensureLessonPlanStandardHeader(bodyContent, {
        fallbackTitle: gen.title,
        logoUrl,
      });
    }
    const header =
      gen.tool === "lesson_plan" || hasStandardHeader ? "" : await buildHeader(gen.discipline_id);
    const body = `${header}${bodyContent}`;
    const status = data.publish ? "published" : "draft";

    if (data.target === "activity") {
      const subtype = data.activity_subtype ?? "free_activity";
      const { error } = await supabaseAdmin.from("activities").insert({
        discipline_id: gen.discipline_id,
        title: data.title,
        instructions: body,
        subtype: subtype as never,
        due_at: data.due_at ?? null,
        rubric: [],
        grading_formula: "weighted_average",
        allow_attachments: true,
        max_attachments: 1,
        status: status as "published" | "draft",
        created_by: context.userId,
        source_generation_id: data.generation_id,
      });
      if (error) throw new Error(error.message);
      if (data.publish) {
        await notifyEnrolledStudents(
          gen.discipline_id, "new_activity", "Nova atividade publicada",
          data.title, `/disciplines/${gen.discipline_id}`,
        );
      }
      return { ok: true, target: "activity" as const };
    }

    if (data.target === "academic_work") {
      const subtype = data.work_subtype ?? "tema_predefinido";
      const { error } = await supabaseAdmin.from("academic_works").insert({
        discipline_id: gen.discipline_id,
        title: data.title,
        instructions: body,
        subtype: subtype as never,
        due_at: data.due_at ?? null,
        rubric: [],
        grading_formula: "weighted_average",
        status: status as "published" | "draft",
        created_by: context.userId,
        source_generation_id: data.generation_id,
      });
      if (error) throw new Error(error.message);
      if (data.publish) {
        await notifyEnrolledStudents(
          gen.discipline_id, "new_work", "Novo trabalho acadêmico publicado",
          data.title, `/disciplines/${gen.discipline_id}`,
        );
      }
      return { ok: true, target: "academic_work" as const };
    }

    // material
    let moduleId = data.module_id;
    if (!moduleId) {
      // Garante um módulo padrão neutro para os materiais didáticos.
      const defaultName = "Materiais didáticos";
      const { data: existing } = await supabaseAdmin
        .from("material_modules").select("id")
        .eq("discipline_id", gen.discipline_id).eq("name", defaultName).maybeSingle();
      if (existing) {
        moduleId = existing.id;
      } else {
        const { count } = await supabaseAdmin
          .from("material_modules").select("*", { count: "exact", head: true })
          .eq("discipline_id", gen.discipline_id);
        const { data: created, error: cErr } = await supabaseAdmin.from("material_modules").insert({
          discipline_id: gen.discipline_id, name: defaultName, position: count ?? 0,
        }).select("id").single();
        if (cErr || !created) throw new Error(cErr?.message ?? "Erro criando módulo");
        moduleId = created.id;
      }
    }
    // Para o "Criador de Slides" geramos e anexamos o arquivo .pptx (PowerPoint),
    // que é o formato prioritário para o aluno — apresentação interativa e
    // editável. O conteúdo Markdown continua disponível para visualização e PDF.
    let fileUrl: string | null = null;
    if (gen.tool === "slides") {
      try {
        const genArg = { tool: gen.tool, title: gen.title, result: gen.result, prompt: gen.prompt };
        const { bytes } = await buildGenerationPPTX(genArg, context.userId);
        // Filename follows the convention "Módulo N: Aula N: Tema" set by the
        // teacher in the dispatch dialog (data.title). The .pptx and .pdf share
        // the same base path so the client can derive the PDF from the PPTX URL.
        const baseName = (data.title || gen.title).replace(/[^\w.-]/g, "_");
        const basePath = `${gen.discipline_id}/${Date.now()}-${baseName}`;
        const pptxPath = `${basePath}.pptx`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("materials")
          .upload(pptxPath, bytes, {
            contentType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            upsert: false,
          });
        if (upErr) throw new Error(upErr.message);
        fileUrl = pptxPath;
        // Visual slides PDF sibling (best-effort — never blocks the dispatch).
        try {
          const visual = await buildGenerationSlidesPDF(genArg, context.userId);
          if (visual) {
            await supabaseAdmin.storage
              .from("materials")
              .upload(`${basePath}.pdf`, visual.bytes, {
                contentType: "application/pdf",
                upsert: false,
              });
          }
        } catch {
          /* PDF sibling is optional; PPTX is the primary deliverable. */
        }
      } catch (e) {
        throw new Error(
          `Falha ao gerar o arquivo PPTX: ${e instanceof Error ? e.message : "erro desconhecido"}`,
        );
      }
    }
    const { error } = await supabaseAdmin.from("materials").insert({
      discipline_id: gen.discipline_id,
      module_id: moduleId,
      title: data.title,
      description: null,
      content: body,
      file_url: fileUrl,
      status: status as "published" | "draft",
      created_by: context.userId,
      source: "ai",
      source_generation_id: data.generation_id,
    });
    if (error) throw new Error(error.message);
    if (data.publish) {
      await notifyEnrolledStudents(
        gen.discipline_id, "new_material", "Novo material publicado",
        data.title, `/disciplines/${gen.discipline_id}`,
      );
    }
    return { ok: true, target: "material" as const };
  });

export const listMaterialModulesForDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { data: rows } = await supabaseAdmin
      .from("material_modules").select("id, name").eq("discipline_id", data.discipline_id)
      .order("position", { ascending: true });
    return { items: rows ?? [] };
  });