import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDueDate } from "@/lib/calendar-titles";
import { assertTeacherOrAdmin } from "./discipline-access.server";

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

export const saveCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    id: z.string().uuid().optional(),
    discipline_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(30000).optional(),
    event_date: z.string(),
    end_date: z.string().optional(),
    kind: z.string().max(40).default("custom"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const payload = {
      discipline_id: data.discipline_id,
      title: data.title,
      description: data.description ?? null,
      event_date: data.event_date,
      end_date: data.end_date ?? null,
      kind: data.kind,
      created_by: context.userId,
    };
    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("calendar_events")
        .update(payload)
        .eq("id", data.id)
        .eq("discipline_id", data.discipline_id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Evento não encontrado ou sem permissão");
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin.from("calendar_events").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ev } = await supabaseAdmin.from("calendar_events").select("discipline_id").eq("id", data.id).maybeSingle();
    if (!ev) throw new Error("Evento não encontrado");
    await assertTeacher(ev.discipline_id, context.userId);
    await supabaseAdmin.from("calendar_events").delete().eq("id", data.id);
    return { ok: true };
  });

const NOTE_MARKER = "[Observação do calendário]";

function mergeNote(existing: string | null | undefined, note: string | undefined) {
  const base = String(existing ?? "").split(NOTE_MARKER)[0].trimEnd();
  if (!note) return base || null;
  return `${base ? `${base}\n\n` : ""}${NOTE_MARKER} ${note}`;
}

export const updateSourceDueDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    source: z.enum(["activity", "work", "exercise", "case", "assessment"]),
    id: z.string().uuid(),
    due_at: z.string().nullable(),
    title: z.string().trim().min(1).max(300).optional(),
    note: z.string().trim().max(30000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const normalizedDueAt = data.due_at ? normalizeDueDate(data.due_at, false) : null;
    if (data.due_at && !normalizedDueAt) throw new Error("Data de envio inválida");
    if (data.source === "case") {
      const { data: c } = await supabaseAdmin.from("clinical_cases").select("discipline_id,description").eq("id", data.id).maybeSingle();
      if (!c) throw new Error("Caso clínico não encontrado");
      await assertTeacher(c.discipline_id, context.userId);
      const { error: caseError } = await supabaseAdmin
        .from("clinical_cases")
        .update({
          due_date: normalizedDueAt,
          ...(data.title ? { title: data.title } : {}),
          ...(data.note !== undefined ? { description: mergeNote(c.description, data.note) } : {}),
        })
        .eq("id", data.id)
        .eq("discipline_id", c.discipline_id);
      if (caseError) throw new Error(caseError.message);
      return { ok: true };
    }
    if (data.source === "assessment") {
      const { data: av } = await supabaseAdmin.from("assessments").select("discipline_id").eq("id", data.id).maybeSingle();
      if (!av) throw new Error("Avaliação não encontrada");
      await assertTeacher(av.discipline_id, context.userId);
      const { error } = await supabaseAdmin
        .from("assessments")
        .update({
          assessment_date: normalizedDueAt ? normalizedDueAt : null,
          ...(data.title ? { title: data.title } : {}),
        })
        .eq("id", data.id)
        .eq("discipline_id", av.discipline_id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const table = data.source === "activity" ? "activities" : data.source === "work" ? "academic_works" : "exercises";
    const selectCols = data.source === "exercise" ? "discipline_id" : "discipline_id,instructions";
    const { data: row } = await supabaseAdmin.from(table).select(selectCols).eq("id", data.id).maybeSingle<{ discipline_id: string; instructions?: string | null }>();
    if (!row) throw new Error("Item não encontrado");
    await assertTeacher(row.discipline_id, context.userId);
    const payload: Record<string, unknown> = {
      due_at: normalizedDueAt,
      ...(data.title ? { title: data.title } : {}),
      ...(data.note !== undefined && data.source !== "exercise"
        ? { instructions: mergeNote(row.instructions, data.note) }
        : {}),
    };
    const { error } = await (supabaseAdmin.from(table) as any)
      .update(payload)
      .eq("id", data.id)
      .eq("discipline_id", row.discipline_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
