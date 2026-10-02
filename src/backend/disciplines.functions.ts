import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

const DEFAULT_DISCIPLINE_STATUS = "active";

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

/** Copies materials, modules, exercise templates (without questions correctness?), activity & work templates,
 *  rubrics, grade structure, attendance settings — but NEVER students, attendance records, grades, submissions. */
export const copyDisciplineToNextSemester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    semester: z.string().min(1).max(10),
    year: z.number().int().min(2000).max(2100),
    group_name: z.string().max(80).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { data: orig } = await supabaseAdmin.from("disciplines").select("*").eq("id", data.discipline_id).maybeSingle();
    if (!orig) throw new Error("Disciplina não encontrada");

    // 1) New discipline
    const { data: created, error: cErr } = await supabaseAdmin.from("disciplines").insert({
      teacher_id: context.userId,
      institution_id: orig.institution_id,
      name: orig.name,
      group_name: data.group_name ?? orig.group_name,
      semester: data.semester,
      year: data.year,
      syllabus_text: orig.syllabus_text,
      syllabus_file_url: orig.syllabus_file_url,
      color: orig.color,
      status: DEFAULT_DISCIPLINE_STATUS,
    }).select().single();
    if (cErr || !created) throw new Error(cErr?.message ?? "Erro ao criar disciplina");
    const newId = created.id;

    // 2) Settings
    const { data: settings } = await supabaseAdmin
      .from("discipline_settings").select("*").eq("discipline_id", data.discipline_id).maybeSingle();
    if (settings) {
      await supabaseAdmin.from("discipline_settings").insert({
        discipline_id: newId,
        attendance_window_hours: settings.attendance_window_hours,
        justified_counts_as_presence: settings.justified_counts_as_presence,
        min_attendance_percent: settings.min_attendance_percent,
      });
    }

    // 3) Material modules + materials (as drafts)
    const { data: mods } = await supabaseAdmin.from("material_modules").select("*").eq("discipline_id", data.discipline_id);
    const moduleIdMap = new Map<string, string>();
    for (const m of mods ?? []) {
      const { data: nm } = await supabaseAdmin.from("material_modules").insert({
        discipline_id: newId, name: m.name, position: m.position,
      }).select("id").single();
      if (nm) moduleIdMap.set(m.id, nm.id);
    }
    const { data: mats } = await supabaseAdmin.from("materials").select("*").eq("discipline_id", data.discipline_id);
    if (mats?.length) {
      const rows = mats
        .filter((m) => moduleIdMap.has(m.module_id))
        .map((m) => ({
          discipline_id: newId,
          module_id: moduleIdMap.get(m.module_id)!,
          title: m.title, description: m.description, content: m.content,
          file_url: m.file_url, source: m.source, status: "draft" as const,
          created_by: context.userId,
        }));
      if (rows.length) await supabaseAdmin.from("materials").insert(rows);
    }

    // 4) Exercises + questions (as drafts)
    const { data: exs } = await supabaseAdmin.from("exercises").select("*").eq("discipline_id", data.discipline_id);
    for (const ex of exs ?? []) {
      const { data: nx } = await supabaseAdmin.from("exercises").insert({
        discipline_id: newId, title: ex.title, topic: ex.topic, type: ex.type,
        question_count: ex.question_count, rubric: ex.rubric, status: "draft",
        created_by: context.userId,
      }).select("id").single();
      if (!nx) continue;
      const { data: qs } = await supabaseAdmin.from("exercise_questions").select("*").eq("exercise_id", ex.id);
      if (qs?.length) {
        await supabaseAdmin.from("exercise_questions").insert(
          qs.map((q) => ({
            exercise_id: nx.id, position: q.position, prompt: q.prompt,
            options: q.options, correct_answer: q.correct_answer,
            explanation: q.explanation, points: q.points,
          })),
        );
      }
    }

    // 5) Activities (templates) as drafts
    const { data: acts } = await supabaseAdmin.from("activities").select("*").eq("discipline_id", data.discipline_id);
    if (acts?.length) {
      await supabaseAdmin.from("activities").insert(
        acts.map((a) => ({
          discipline_id: newId, title: a.title, instructions: a.instructions,
          subtype: a.subtype, rubric: a.rubric, allow_attachments: a.allow_attachments,
          max_attachments: a.max_attachments, cover_config: a.cover_config,
          format_config: a.format_config, structure_config: a.structure_config,
          status: "draft" as const, created_by: context.userId,
        })),
      );
    }

    // 6) Academic works (templates) as drafts
    const { data: works } = await supabaseAdmin.from("academic_works").select("*").eq("discipline_id", data.discipline_id);
    if (works?.length) {
      await supabaseAdmin.from("academic_works").insert(
        works.map((w) => ({
          discipline_id: newId, title: w.title, instructions: w.instructions,
          rubric: w.rubric, structure_config: w.structure_config,
          format_config: w.format_config, cover_config: w.cover_config,
          status: "draft" as const, created_by: context.userId,
        })),
      );
    }

    // 7) Grade structure (skeleton, no entries)
    const { data: gs } = await supabaseAdmin
      .from("grade_structures").select("*").eq("discipline_id", data.discipline_id).maybeSingle();
    if (gs) {
      await supabaseAdmin.from("grade_structures").insert({
        discipline_id: newId,
        assessments: gs.assessments,
        formula: gs.formula,
        passing_average: gs.passing_average,
        recovery_min: gs.recovery_min,
        recovery_average: (gs as unknown as { recovery_average?: number | null }).recovery_average ?? null,
        grade_scale: (gs as unknown as { grade_scale?: number }).grade_scale ?? 10,
        recovery_config: (gs as unknown as { recovery_config?: unknown }).recovery_config ?? null,
      } as never);
    }

    return { id: newId };
  });

/** Soft archive / unarchive */
export const setDisciplineStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    status: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : DEFAULT_DISCIPLINE_STATUS),
      z.string().min(1).default(DEFAULT_DISCIPLINE_STATUS),
    ),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("disciplines")
      .update({ status: data.status }).eq("id", data.discipline_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Hard delete with safety check (must match name + no enrolled students or attendance sessions). */
export const deleteDiscipline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    confirm_name: z.string().min(1).max(200),
    force: z.boolean().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { data: disc } = await supabaseAdmin
      .from("disciplines").select("name").eq("id", data.discipline_id).maybeSingle();
    if (!disc) throw new Error("Disciplina não encontrada");
    if (disc.name.trim().toLowerCase() !== data.confirm_name.trim().toLowerCase()) {
      throw new Error("Nome de confirmação incorreto");
    }

    const { count: enrolled } = await supabaseAdmin
      .from("discipline_students").select("*", { count: "exact", head: true })
      .eq("discipline_id", data.discipline_id);
    const { count: sessions } = await supabaseAdmin
      .from("attendance_sessions").select("*", { count: "exact", head: true })
      .eq("discipline_id", data.discipline_id);

    if (((enrolled ?? 0) > 0 || (sessions ?? 0) > 0) && !data.force) {
      throw new Error(
        `Esta disciplina possui ${enrolled ?? 0} aluno(s) matriculado(s) e ${sessions ?? 0} chamada(s) registrada(s). Recomendamos arquivar. Confirme com force=true para excluir definitivamente.`,
      );
    }

    // Cascade delete related rows manually (bypasses RLS via admin client).
    const did = data.discipline_id;
    // Fetch dependent ids to cascade their children.
    const [{ data: sessionsRows }, { data: actsRows }, { data: worksRows }, { data: exsRows }] = await Promise.all([
      supabaseAdmin.from("attendance_sessions").select("id").eq("discipline_id", did),
      supabaseAdmin.from("activities").select("id").eq("discipline_id", did),
      supabaseAdmin.from("academic_works").select("id").eq("discipline_id", did),
      supabaseAdmin.from("exercises").select("id").eq("discipline_id", did),
    ]);
    const sessionIds = (sessionsRows ?? []).map((r: { id: string }) => r.id);
    const actIds = (actsRows ?? []).map((r: { id: string }) => r.id);
    const workIds = (worksRows ?? []).map((r: { id: string }) => r.id);
    const exIds = (exsRows ?? []).map((r: { id: string }) => r.id);

    if (sessionIds.length) {
      await supabaseAdmin.from("attendance_records").delete().in("session_id", sessionIds);
      await supabaseAdmin.from("justifications").delete().in("session_id", sessionIds);
    }
    if (actIds.length) {
      await supabaseAdmin.from("activity_submissions").delete().in("activity_id", actIds);
    }
    if (workIds.length) {
      await supabaseAdmin.from("academic_work_submissions").delete().in("work_id", workIds);
    }
    if (exIds.length) {
      await supabaseAdmin.from("exercise_submissions").delete().in("exercise_id", exIds);
      await supabaseAdmin.from("exercise_questions").delete().in("exercise_id", exIds);
    }

    // Delete direct children
    await Promise.all([
      supabaseAdmin.from("attendance_sessions").delete().eq("discipline_id", did),
      supabaseAdmin.from("activities").delete().eq("discipline_id", did),
      supabaseAdmin.from("academic_works").delete().eq("discipline_id", did),
      supabaseAdmin.from("exercises").delete().eq("discipline_id", did),
      supabaseAdmin.from("materials").delete().eq("discipline_id", did),
      supabaseAdmin.from("material_modules").delete().eq("discipline_id", did),
      supabaseAdmin.from("calendar_events").delete().eq("discipline_id", did),
      supabaseAdmin.from("chat_messages").delete().eq("discipline_id", did),
      supabaseAdmin.from("discipline_settings").delete().eq("discipline_id", did),
      supabaseAdmin.from("discipline_students").delete().eq("discipline_id", did),
      supabaseAdmin.from("grade_entries").delete().eq("discipline_id", did),
      supabaseAdmin.from("grade_structures").delete().eq("discipline_id", did),
      supabaseAdmin.from("student_diary_entries").delete().eq("discipline_id", did),
      supabaseAdmin.from("student_documents").delete().eq("discipline_id", did),
      supabaseAdmin.from("ai_generations").delete().eq("discipline_id", did),
    ]);

    const { error } = await supabaseAdmin.from("disciplines").delete().eq("id", did);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Header info for activity/work documents shown to students. */
export const getDisciplineHeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    if (!uid) {
      console.warn("[getDisciplineHeader] No user session found.");
      return null;
    }

    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("id, name, group_name, teacher_id, institution_id")
      .eq("id", data.discipline_id)
      .maybeSingle();

    if (!disc) {
      console.warn(`[getDisciplineHeader] Discipline not found: ${data.discipline_id}`);
      return null;
    }

    // Permission: teacher of discipline, enrolled student, same institution, or admin.
    const isTeacher = disc.teacher_id === uid;
    let allowed = isTeacher;
    if (!allowed) {
      const { data: enr } = await supabaseAdmin
        .from("discipline_students").select("student_id")
        .eq("discipline_id", disc.id).eq("student_id", uid).maybeSingle();
      if (enr) allowed = true;
    }
    if (!allowed) {
      console.warn(`[getDisciplineHeader] User ${uid} has no permission for discipline ${disc.id}`);
      return null;
    }

    const [{ data: teacher }, instRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle(),
      disc.institution_id
        ? supabaseAdmin.from("institutions").select("name").eq("id", disc.institution_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      institution_name: instRes.data?.name ?? null,
      course_name: disc.group_name ?? null,
      discipline_name: disc.name,
      teacher_name: teacher?.name ?? null,
    };
  });

export const joinDisciplineByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ code: z.string().trim().min(2).max(20) }).parse(input))
  .handler(async ({ data, context }) => {
    const code = data.code.replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (!code) throw new Error("Informe um código válido");
    const { data: disc, error } = await supabaseAdmin
      .from("disciplines")
      .select("id,name,status")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!disc || disc.status !== "active") throw new Error("Disciplina não encontrada");
    const { error: enrollError } = await supabaseAdmin
      .from("discipline_students")
      .insert({ discipline_id: disc.id, student_id: context.userId });
    if (enrollError && enrollError.code !== "23505") throw new Error(enrollError.message);
    return { ok: true, discipline_id: disc.id, name: disc.name, already_enrolled: enrollError?.code === "23505" };
  });

/** Lists all teachers (for the student enrollment browser). */
export const listEnrollableTeachers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Busca simples com a sessão do próprio aluno: a função do banco devolve apenas
    // id, nome e instituição de quem tem o perfil/role de professor (sem assinaturas).
    const { data, error } = await (context.supabase as any).rpc("list_enrollable_teachers");
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    return ((data ?? []) as Array<{ id: string; name: string | null; institution_name: string | null }>)
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .map((p) => ({
        id: p.id,
        name: p.name ?? "Professor(a)",
        institution_name: p.institution_name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  });

/** Lists active disciplines for a given teacher (for the student enrollment browser). */
export const listEnrollableDisciplines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ teacher_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: discs } = await supabaseAdmin
      .from("disciplines")
      .select("id, name, semester, year, group_name")
      .eq("teacher_id", data.teacher_id)
      .eq("status", "active")
      .order("name");
    return discs ?? [];
  });

/** Enrolls the current student into a discipline by its id (no access code required). */
export const joinDisciplineById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: disc, error } = await supabaseAdmin
      .from("disciplines")
      .select("id,name,status")
      .eq("id", data.discipline_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!disc || disc.status !== "active") throw new Error("Disciplina não encontrada");
    const { error: enrollError } = await supabaseAdmin
      .from("discipline_students")
      .insert({ discipline_id: disc.id, student_id: context.userId });
    if (enrollError && enrollError.code !== "23505") throw new Error(enrollError.message);
    return { ok: true, discipline_id: disc.id, name: disc.name, already_enrolled: enrollError?.code === "23505" };
  });

/** Saves the teacher's custom ordering of their disciplines (drag & drop). */
export const reorderDisciplines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    ordered_ids: z.array(z.string().uuid()).min(1).max(500),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: owned } = await supabaseAdmin
      .from("disciplines")
      .select("id")
      .eq("teacher_id", context.userId)
      .in("id", data.ordered_ids);
    const ownedIds = new Set((owned ?? []).map((d) => d.id));
    let position = 0;
    for (const id of data.ordered_ids) {
      if (!ownedIds.has(id)) continue;
      position += 1;
      await supabaseAdmin.from("disciplines").update({ sort_order: position }).eq("id", id).eq("teacher_id", context.userId);
    }
    return { ok: true };
  });
