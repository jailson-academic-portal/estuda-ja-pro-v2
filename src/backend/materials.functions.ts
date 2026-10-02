import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents } from "./notifications.server";
import { assertTeacherOrAdmin, userIsAdmin } from "./discipline-access.server";
import { buildDocumentFilename } from "@/lib/document-filename";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function pdfSafe(text: string) {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "");
}

function stripMarkdown(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

async function renderMaterialPDF(title: string, description: string | null, content: string | null) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const wrap = (text: string, size: number, f = font) => {
    const lines: string[] = [];
    for (const paragraph of pdfSafe(stripMarkdown(text)).split("\n")) {
      if (!paragraph.trim()) { lines.push(""); continue; }
      const words = paragraph.split(/\s+/);
      let cur = "";
      for (const word of words) {
        const next = cur ? `${cur} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > maxWidth) { if (cur) lines.push(cur); cur = word; }
        else cur = next;
      }
      if (cur) lines.push(cur);
    }
    return lines;
  };
  const newPage = () => { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };
  const draw = (text: string, size: number, f = font, color = rgb(0.1, 0.1, 0.15)) => {
    if (y < margin + size + 4) newPage();
    page.drawText(pdfSafe(text), { x: margin, y: y - size, size, font: f, color });
    y -= size + 5;
  };
  wrap(title, 18, fontBold).forEach((line) => draw(line, 18, fontBold, rgb(0.1, 0.3, 0.6)));
  if (description) { y -= 6; wrap(description, 11, fontBold).forEach((line) => draw(line, 11, fontBold)); }
  y -= 10;
  wrap(content || "Material sem conteúdo textual.", 11).forEach((line) => line ? draw(line, 11) : (y -= 5));
  return pdf.save();
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\p{L}\p{N}\s_.-]/gu, "").trim().replace(/\s+/g, "_") || "material";
}

export const createMaterialModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { count } = await supabaseAdmin
      .from("material_modules").select("*", { count: "exact", head: true })
      .eq("discipline_id", data.discipline_id);
    const { data: row, error } = await supabaseAdmin.from("material_modules").insert({
      discipline_id: data.discipline_id,
      name: data.name,
      position: count ?? 0,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteMaterialModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("material_modules").select("discipline_id").eq("id", data.id).maybeSingle();
    if (!m) throw new Error("Módulo não encontrado");
    await assertTeacher(m.discipline_id, context.userId);
    await supabaseAdmin.from("materials").delete().eq("module_id", data.id);
    await supabaseAdmin.from("material_modules").delete().eq("id", data.id);
    return { ok: true };
  });

export const saveMaterial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    id: z.string().uuid().optional(),
    discipline_id: z.string().uuid(),
    module_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(30000).optional(),
    content: z.string().trim().max(50000).optional(),
    file_url: z.string().max(500).optional(),
    source: z.string().optional(),
    publish: z.boolean().default(false),

  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const status = data.publish ? "published" : "draft";
    const payload = {
      discipline_id: data.discipline_id,
      module_id: data.module_id,
      title: data.title,
      description: data.description ?? null,
      content: data.content ?? null,
      file_url: data.file_url ?? null,
      status: status as "published" | "draft",
      created_by: context.userId,
      source: data.source ?? "manual",
    };

    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("materials")
        .update(payload)
        .eq("id", data.id)
        .eq("created_by", context.userId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Material não encontrado ou sem permissão");
    } else {
      const { error } = await supabaseAdmin.from("materials").insert(payload);
      if (error) throw new Error(error.message);
    }
    if (data.publish) {
      const { data: disc } = await supabaseAdmin
        .from("disciplines")
        .select("name")
        .eq("id", data.discipline_id)
        .maybeSingle();

      await notifyEnrolledStudents(
        data.discipline_id,
        "new_material",
        `📚 Novo Material: ${data.title}`,
        `Professor postou um novo material em ${disc?.name ?? "sua disciplina"}`,
        `/disciplines/${data.discipline_id}?tab=materials`,
      );
    }

    return { ok: true };
  });

export const deleteMaterial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("materials").select("discipline_id").eq("id", data.id).maybeSingle();
    if (!m) throw new Error("Material não encontrado");
    await assertTeacher(m.discipline_id, context.userId);
    await supabaseAdmin.from("materials").delete().eq("id", data.id);
    return { ok: true };
  });

export const exportMaterialPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const uid = context.userId;
      if (!uid) {
        console.warn("[exportMaterialPDF] No authenticated user session.");
        return null;
      }

      const { data: material } = await supabaseAdmin
        .from("materials")
        .select("id,discipline_id,title,description,content,status")
        .eq("id", data.id)
        .maybeSingle();

      if (!material) {
        console.warn(`[exportMaterialPDF] Material not found: ${data.id}`);
        return null;
      }

      const { data: disc } = await supabaseAdmin
        .from("disciplines")
        .select("teacher_id")
        .eq("id", material.discipline_id)
        .maybeSingle();
      
      const allowedTeacher = disc?.teacher_id === context.userId || (await userIsAdmin(context.userId));
      let allowedStudent = false;
      if (!allowedTeacher && material.status === "published") {
        const { data: enrollment } = await supabaseAdmin
          .from("discipline_students")
          .select("id")
          .eq("discipline_id", material.discipline_id)
          .eq("student_id", context.userId)
          .maybeSingle();
        allowedStudent = Boolean(enrollment);
      }
      if (!allowedTeacher && !allowedStudent) {
        console.warn(`[exportMaterialPDF] User ${uid} has no permission for material ${material.id}`);
        return null;
      }

      const [{ buildMaterialDocumentPDF }, logoUrl] = await Promise.all([
        import("./ai-export.functions"),
        disc?.teacher_id
          ? import("./branding.server")
              .then((m) => m.resolveBrandingLogoUrl(disc.teacher_id))
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      let bytes: Uint8Array;
      try {
        bytes = await buildMaterialDocumentPDF(
          material.title,
          material.description,
          material.content,
          logoUrl,
        );
      } catch (err) {
        console.warn("[exportMaterialPDF] Rich renderer failed, falling back to simple PDF:", err);
        bytes = await renderMaterialPDF(material.title, material.description, material.content);
      }
      return {
        filename: `${sanitizeFilename(buildDocumentFilename(material.title, material.content))}.pdf`,
        mime: "application/pdf",
        base64: bufferToBase64(bytes),
      };
    } catch (e) {
      console.error("[exportMaterialPDF] Fatal error:", e);
      return null;
    }
  });
/**
 * Listagem enxuta dos materiais para o portal do aluno: NUNCA retorna o corpo
 * completo (content) — apenas os metadados necessários para renderizar os cards.
 */
export const listMaterialsForStudent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const disciplineId = data.discipline_id;

    const { data: disc } = await supabaseAdmin
      .from("disciplines").select("teacher_id").eq("id", disciplineId).maybeSingle();
    let allowed = disc?.teacher_id === context.userId;
    if (!allowed) {
      const { data: enrollment } = await supabaseAdmin
        .from("discipline_students").select("id")
        .eq("discipline_id", disciplineId).eq("student_id", context.userId).maybeSingle();
      allowed = Boolean(enrollment);
    }
    if (!allowed) allowed = await userIsAdmin(context.userId);
    if (!allowed) throw new Error("Sem permissão");

    const [{ data: mods }, { data: mats }, { data: withContent }] = await Promise.all([
      supabaseAdmin
        .from("material_modules").select("id,name,position")
        .eq("discipline_id", disciplineId).order("position", { ascending: true }),
      supabaseAdmin
        .from("materials")
        .select("id,module_id,title,description,file_url,status,position,created_at,source")
        .eq("discipline_id", disciplineId)
        .eq("status", "published")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      // Apenas os ids que possuem corpo de texto — o conteúdo em si nunca é lido aqui.
      supabaseAdmin
        .from("materials")
        .select("id")
        .eq("discipline_id", disciplineId)
        .eq("status", "published")
        .not("content", "is", null)
        .neq("content", ""),
    ]);
    const contentIds = new Set((withContent ?? []).map((r) => r.id));

    return {
      modules: (mods ?? []).map((m) => ({ id: m.id, name: m.name, position: m.position ?? 0 })),
      materials: (mats ?? []).map((m) => ({
        id: m.id,
        module_id: m.module_id,
        title: m.title,
        description: m.description,
        file_url: m.file_url,
        status: m.status as "published",
        position: (m as { position?: number | null }).position ?? 0,
        created_at: m.created_at,
        source: m.source ?? undefined,
        has_content: contentIds.has(m.id),
      })),
    };
  });
