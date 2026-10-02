import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface InstitutionOverview {
  institutionId: string | null;
  teachers: number;
  students: number;
  disciplines: number;
  teacherList: { id: string; name: string; email: string | null }[];
}

/**
 * Visão geral do painel da instituição.
 * Roda no servidor com service role e retorna APENAS os dados necessários.
 * Alunos nunca têm e-mail exposto: só contamos alunos e listamos professores
 * (que são a equipe da própria instituição).
 */
export const getInstitutionOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InstitutionOverview> => {
    const { userId } = context;
    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("profile_type")
      .eq("id", userId)
      .maybeSingle();

    if (me?.profile_type !== "institution" && me?.profile_type !== "admin") {
      throw new Error("Apenas instituições podem acessar este painel.");
    }
    const { resolveInstitutionId, listTeacherProfiles } = await import("./institution.server");
    const instId = await resolveInstitutionId(userId);
    if (!instId) {
      return { institutionId: null, teachers: 0, students: 0, disciplines: 0, teacherList: [] };
    }

    const [teacherList, sc, dc] = await Promise.all([
      listTeacherProfiles(instId),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true })
        .eq("profile_type", "student").eq("institution_id", instId),
      supabaseAdmin.from("disciplines").select("id", { count: "exact", head: true })
        .eq("institution_id", instId).eq("status", "active"),
    ]);

    return {
      institutionId: instId,
      teachers: teacherList.length,
      students: sc.count ?? 0,
      disciplines: dc.count ?? 0,
      teacherList,
    };
  });

export const listInstitutionTeachers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireInstitution, listTeacherProfiles } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);
    return await listTeacherProfiles(instId);
  });

export const listInstitutionDisciplines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireInstitution } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);
    const { data: discs } = await supabaseAdmin
      .from("disciplines")
      .select("id, name, code, group_name, semester, year, status, color, teacher_id, location, class_start_time, class_end_time, start_date, end_date")
      .eq("institution_id", instId)
      .order("name");
    const list = discs ?? [];
    const teacherIds = [...new Set(list.map((d) => d.teacher_id).filter(Boolean))] as string[];
    const teacherMap = new Map<string, string>();
    if (teacherIds.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, name").in("id", teacherIds);
      for (const p of profs ?? []) teacherMap.set(p.id, p.name ?? "Professor(a)");
    }
    const counts = new Map<string, number>();
    if (list.length) {
      const { data: enr } = await supabaseAdmin
        .from("discipline_students")
        .select("discipline_id")
        .in("discipline_id", list.map((d) => d.id));
      for (const e of enr ?? []) counts.set(e.discipline_id, (counts.get(e.discipline_id) ?? 0) + 1);
    }
    return list.map((d) => ({
      ...d,
      teacher_name: d.teacher_id ? teacherMap.get(d.teacher_id) ?? null : null,
      student_count: counts.get(d.id) ?? 0,
    }));
  });

export const createInstitutionDiscipline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    name: z.string().trim().min(2).max(120),
    teacher_id: z.string().uuid(),
    group_name: z.string().trim().max(80).optional(),
    semester: z.string().trim().min(1).max(10),
    year: z.number().int().min(2000).max(2100),
    color: z.string().trim().max(20).optional(),
    location: z.string().trim().max(120).optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    class_start_time: z.string().optional(),
    class_end_time: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitution, assertTeacherOfInstitution } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);
    await assertTeacherOfInstitution(instId, data.teacher_id);
    const { data: created, error } = await supabaseAdmin.from("disciplines").insert({
      institution_id: instId,
      teacher_id: data.teacher_id,
      name: data.name,
      group_name: data.group_name || null,
      semester: data.semester,
      year: data.year,
      color: data.color || "#0EA5A4",
      location: data.location || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      class_start_time: data.class_start_time || null,
      class_end_time: data.class_end_time || null,
      status: "active",
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: created!.id };
  });

export const updateInstitutionDiscipline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    name: z.string().trim().min(2).max(120).optional(),
    teacher_id: z.string().uuid().optional(),
    group_name: z.string().trim().max(80).nullable().optional(),
    semester: z.string().trim().min(1).max(10).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitutionDiscipline, assertTeacherOfInstitution } = await import("./institution.server");
    const { instId } = await requireInstitutionDiscipline(context.userId, data.discipline_id);
    if (data.teacher_id) await assertTeacherOfInstitution(instId, data.teacher_id);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "teacher_id", "group_name", "semester", "year", "location", "status"] as const) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await supabaseAdmin.from("disciplines").update(patch as never).eq("id", data.discipline_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Diary configuration (attendance rules + grade structure) set by the institution. */
export const getInstitutionDisciplineConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitutionDiscipline } = await import("./institution.server");
    await requireInstitutionDiscipline(context.userId, data.discipline_id);
    const [settings, structure] = await Promise.all([
      supabaseAdmin.from("discipline_settings").select("*").eq("discipline_id", data.discipline_id).maybeSingle(),
      supabaseAdmin.from("grade_structures").select("*").eq("discipline_id", data.discipline_id).maybeSingle(),
    ]);
    return { settings: settings.data ?? null, structure: structure.data ?? null };
  });

export const saveInstitutionDisciplineConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    min_attendance_percent: z.number().min(0).max(100),
    justified_counts_as_presence: z.boolean(),
    attendance_window_hours: z.number().int().min(1).max(720),
    grade_scale: z.union([z.literal(10), z.literal(100)]),
    passing_average: z.number().min(0).max(100),
    assessments: z.array(z.object({
      id: z.string().min(1).max(40),
      name: z.string().min(1).max(80),
      weight: z.number().min(0).max(100),
      max_score: z.number().min(0.1).max(100),
    })).min(1).max(20),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitutionDiscipline } = await import("./institution.server");
    await requireInstitutionDiscipline(context.userId, data.discipline_id);
    if (data.passing_average > data.grade_scale) throw new Error("Média de aprovação não pode ser maior que a escala.");
    const total = data.assessments.reduce((s, a) => s + a.weight, 0);
    if (Math.abs(total - 100) > 0.01) throw new Error(`A soma dos pesos deve ser 100% (atual: ${total}%).`);

    const { error: sErr } = await supabaseAdmin.from("discipline_settings").upsert({
      discipline_id: data.discipline_id,
      min_attendance_percent: data.min_attendance_percent,
      justified_counts_as_presence: data.justified_counts_as_presence,
      attendance_window_hours: data.attendance_window_hours,
    } as never, { onConflict: "discipline_id" });
    if (sErr) throw new Error(sErr.message);

    const { error: gErr } = await supabaseAdmin.from("grade_structures").upsert({
      discipline_id: data.discipline_id,
      assessments: data.assessments,
      formula: "weighted_average",
      grade_scale: data.grade_scale,
      passing_average: data.passing_average,
    } as never, { onConflict: "discipline_id" });
    if (gErr) throw new Error(gErr.message);
    return { ok: true };
  });

/** Students of the institution, with the disciplines they are enrolled in. */
export const listInstitutionStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireInstitution } = await import("./institution.server");
    const instId = await requireInstitution(context.userId);
    const { data: studs } = await supabaseAdmin
      .from("profiles")
      .select("id, name, enrollment_number, email")
      .eq("profile_type", "student")
      .eq("institution_id", instId)
      .order("name");
    const list = studs ?? [];
    if (!list.length) return [];
    const { data: discs } = await supabaseAdmin
      .from("disciplines").select("id, name").eq("institution_id", instId);
    const nameById = new Map((discs ?? []).map((d) => [d.id, d.name]));
    const { data: enr } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id, discipline_id")
      .in("student_id", list.map((s) => s.id));
    const byStudent = new Map<string, string[]>();
    for (const e of enr ?? []) {
      const dn = nameById.get(e.discipline_id);
      if (!dn) continue;
      byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), dn]);
    }
    return list.map((s) => ({ ...s, disciplines: byStudent.get(s.id) ?? [] }));
  });

export const enrollStudentsInDiscipline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    student_ids: z.array(z.string().uuid()).min(1).max(500),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitutionDiscipline, requireInstitution } = await import("./institution.server");
    const { instId } = await requireInstitutionDiscipline(context.userId, data.discipline_id);
    await requireInstitution(context.userId);
    const { data: valid } = await supabaseAdmin
      .from("profiles").select("id")
      .eq("institution_id", instId).eq("profile_type", "student")
      .in("id", data.student_ids);
    const ids = (valid ?? []).map((v) => v.id);
    if (!ids.length) throw new Error("Nenhum aluno válido selecionado.");
    const { error } = await supabaseAdmin
      .from("discipline_students")
      .upsert(ids.map((id) => ({ discipline_id: data.discipline_id, student_id: id })) as never,
        { onConflict: "discipline_id,student_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, enrolled: ids.length };
  });

/** Read-only grade sheet of a discipline for the institution panel. */
export const getInstitutionDisciplineGrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireInstitutionDiscipline } = await import("./institution.server");
    const { disc } = await requireInstitutionDiscipline(context.userId, data.discipline_id);
    const [{ data: structure }, { data: enr }, { data: entries }] = await Promise.all([
      supabaseAdmin.from("grade_structures").select("assessments, passing_average, grade_scale")
        .eq("discipline_id", data.discipline_id).maybeSingle(),
      supabaseAdmin.from("discipline_students").select("student_id").eq("discipline_id", data.discipline_id),
      supabaseAdmin.from("grade_entries").select("student_id, assessment_id, score").eq("discipline_id", data.discipline_id),
    ]);
    const ids = (enr ?? []).map((e) => e.student_id);
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, name, enrollment_number").in("id", ids)
      : { data: [] as { id: string; name: string; enrollment_number: string | null }[] };
    const students = (profs ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pt-BR"));
    return {
      discipline_name: disc.name,
      structure: structure ?? null,
      students,
      entries: entries ?? [],
    };
  });
