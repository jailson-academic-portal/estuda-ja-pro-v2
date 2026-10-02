import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents, notifyUsers } from "./notifications.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

const WINDOW_HOURS_DEFAULT = 72;
const JUSTIFICATION_HOURS = 72;
const CODE_WINDOW_MINUTES_DEFAULT = 15;
const CODE_WINDOW_MIN = 5;
const CODE_WINDOW_MAX = 240;

function datePartFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Frontend clock source: countdowns must use the same clock family as backend validation. */
export const getAttendanceServerTime = createServerFn({ method: "GET" }).handler(async () => ({
  now: new Date().toISOString(),
}));

function generateCode(len = 6): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < len; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

async function getWindowHours(disciplineId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("discipline_settings")
    .select("attendance_window_hours")
    .eq("discipline_id", disciplineId)
    .maybeSingle();
  return data?.attendance_window_hours ?? WINDOW_HOURS_DEFAULT;
}

function isOpen(startsAt: string, windowHours: number): boolean {
  const start = new Date(startsAt).getTime();
  const now = Date.now();
  return now >= start && now - start < windowHours * 60 * 60 * 1000;
}

/**
 * Justification window: 72h (or discipline setting) counted from the moment the
 * attendance code ends — either when the teacher manually closes the diary
 * (`closed_at`) or when the code window elapses naturally.
 */
function justificationOpen(
  startsAt: string,
  codeWindowMinutes: number,
  closedAt: string | null | undefined,
  _windowHours: number,
  atMs: number = Date.now(),
): boolean {
  const start = new Date(startsAt).getTime();
  const naturalEnd = start + codeWindowMinutes * 60 * 1000;
  const codeEnd = closedAt ? Math.min(new Date(closedAt).getTime(), naturalEnd) : naturalEnd;
  if (atMs < codeEnd) return false;
  return atMs - codeEnd < JUSTIFICATION_HOURS * 60 * 60 * 1000;
}

function hasStarted(startsAt: string): boolean {
  return Date.now() >= new Date(startsAt).getTime();
}

function hasWindowEnded(startsAt: string, windowHours: number): boolean {
  return Date.now() >= new Date(startsAt).getTime() + windowHours * 60 * 60 * 1000;
}

/**
 * A "sessão de presença" está aberta em `atMs` quando: já começou, ainda está
 * dentro da janela do código e não foi encerrada manualmente pelo professor.
 */
function codeOpenAt(
  startsAt: string,
  codeWindowMinutes: number,
  closedAt: string | null | undefined,
  atMs: number,
): boolean {
  const start = new Date(startsAt).getTime();
  if (atMs < start) return false;
  if (atMs - start >= codeWindowMinutes * 60 * 1000) return false;
  if (closedAt && atMs >= new Date(closedAt).getTime()) return false;
  return true;
}

/** Teacher creates a new attendance session with a generated 6-letter code. */
export const createAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        discipline_id: z.string().uuid(),
        topic: z.string().trim().max(200).optional(),
        session_date: z.string().optional(),
        code_window_minutes: z.number().int().min(CODE_WINDOW_MIN).max(CODE_WINDOW_MAX).optional(),
        starts_at: z.string().datetime().optional(),
        programmatic_content: z.string().trim().optional(),
        pedagogical_observations: z.string().trim().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!context.userId) {
      console.warn("[createAttendanceSession] No authenticated user.");
      return null;
    }
    await assertTeacher(data.discipline_id, context.userId);
    const windowHours = await getWindowHours(data.discipline_id);
    const codeWindowMinutes = data.code_window_minutes ?? CODE_WINDOW_MINUTES_DEFAULT;

    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const { data: collide } = await supabaseAdmin
        .from("attendance_sessions")
        .select("id")
        .eq("discipline_id", data.discipline_id)
        .eq("code", code)
        .gte("created_at", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();
      if (!collide) break;
      code = generateCode();
    }

    const startsAt = data.starts_at ?? new Date().toISOString();
    const insertData: any = {
      discipline_id: data.discipline_id,
      teacher_id: context.userId,
      topic: data.topic ?? null,
      session_date: data.session_date ?? datePartFromIso(startsAt),
      code,
      window_hours: windowHours,
      code_window_minutes: codeWindowMinutes,
      starts_at: startsAt,
    };
    if (data.programmatic_content) insertData.programmatic_content = data.programmatic_content;
    if (data.pedagogical_observations) insertData.pedagogical_observations = data.pedagogical_observations;

    const { data: session, error } = await supabaseAdmin
      .from("attendance_sessions")
      .insert(insertData)
      .select()
      .single();
    if (error) {
      console.error("[createAttendanceSession] Database error:", error.message);
      return null;
    }

    const startsNow = Date.now() >= new Date(startsAt).getTime();
    await notifyEnrolledStudents(
      data.discipline_id,
      "attendance_session_open",
      startsNow ? "Nova chamada aberta" : "Chamada agendada",
      startsNow
        ? `O professor abriu uma nova chamada. Você tem ${codeWindowMinutes} minutos para inserir o código de presença.`
        : `O professor agendou uma chamada para ${new Date(startsAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
      `/disciplines/${data.discipline_id}`,
    );

    return session;
  });

/** Student confirms presence with the verbal code. */
export const confirmAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{6}$/, "Código deve ter 6 letras"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session, error } = await supabaseAdmin
      .from("attendance_sessions")
      .select("*")
      .eq("id", data.session_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Sessão não encontrada");

    const codeWindowMinutes = session.code_window_minutes ?? CODE_WINDOW_MINUTES_DEFAULT;
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    if (Date.now() < new Date(startsAt).getTime()) {
      throw new Error("A chamada ainda não foi aberta. Aguarde o horário definido pelo professor.");
    }
    const closedAt = (session as { closed_at?: string | null }).closed_at ?? null;
    if (closedAt && Date.now() >= new Date(closedAt).getTime()) {
      throw new Error(
        "A presença desta aula foi encerrada pelo professor. Você ainda pode enviar uma justificativa de falta.",
      );
    }
    if (!codeOpenAt(startsAt, codeWindowMinutes, closedAt, Date.now())) {
      throw new Error(
        `O código de presença expirou (válido por ${codeWindowMinutes} min). Você ainda pode enviar uma justificativa de falta.`,
      );
    }

    if (session.code.toUpperCase() !== data.code.toUpperCase()) {
      throw new Error("Código incorreto");
    }

    const { data: enroll } = await supabaseAdmin
      .from("discipline_students")
      .select("id")
      .eq("discipline_id", session.discipline_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (!enroll) throw new Error("Você não está matriculado nesta disciplina");

    const { error: upErr } = await supabaseAdmin.from("attendance_records").upsert(
      {
        session_id: data.session_id,
        student_id: context.userId,
        status: "present" as const,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "session_id,student_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/**
 * Aluno confirma presença apenas pelo código de 6 letras — o servidor procura,
 * entre as disciplinas em que o aluno está matriculado, uma sessão aberta cujo
 * código bata. Usado no atalho de presença rápida no dashboard.
 */
export const confirmAttendanceByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{6}$/, "Código deve ter 6 letras"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const code = data.code.toUpperCase();
    const { data: enrollments, error: enrErr } = await supabaseAdmin
      .from("discipline_students")
      .select("discipline_id")
      .eq("student_id", context.userId);
    if (enrErr) throw new Error(enrErr.message);
    const disciplineIds = (enrollments ?? []).map((e) => e.discipline_id);
    if (disciplineIds.length === 0) {
      throw new Error("Você não está matriculado em nenhuma disciplina.");
    }

    const { data: matches, error: sErr } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id, discipline_id, topic, session_date, code_window_minutes, starts_at, closed_at, created_at")
      .in("discipline_id", disciplineIds)
      .ilike("code", code)
      .is("finalized_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    if (sErr) throw new Error(sErr.message);

    const now = Date.now();
    const openSession = (matches ?? []).find((s) => {
      const startsAt = (s as { starts_at?: string }).starts_at ?? s.created_at;
      const closedAt = (s as { closed_at?: string | null }).closed_at ?? null;
      const codeWindowMinutes = s.code_window_minutes ?? CODE_WINDOW_MINUTES_DEFAULT;
      if (now < new Date(startsAt).getTime()) return false;
      return codeOpenAt(startsAt, codeWindowMinutes, closedAt, now);
    });
    if (!openSession) {
      throw new Error("Nenhuma chamada aberta com esse código no momento.");
    }

    const { error: upErr } = await supabaseAdmin.from("attendance_records").upsert(
      {
        session_id: openSession.id,
        student_id: context.userId,
        status: "present" as const,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "session_id,student_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { ok: true, session_id: openSession.id, discipline_id: openSession.discipline_id };
  });

/**
 * Aluno marca presença apenas com o id da sessão (botão grande / leitura de QR),
 * sem precisar digitar o código. Válido somente enquanto a sessão está aberta.
 * Suporta sincronização offline via `marked_at`: a validação da janela usa o
 * horário real da marcação; se estiver fora da janela, a marcação é recusada.
 */
export const markPresenceBySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        marked_at: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session, error } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id, discipline_id, code_window_minutes, starts_at, closed_at, created_at")
      .eq("id", data.session_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Sessão não encontrada");

    const codeWindowMinutes = session.code_window_minutes ?? CODE_WINDOW_MINUTES_DEFAULT;
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    const closedAt = (session as { closed_at?: string | null }).closed_at ?? null;
    const markMs = data.marked_at ? new Date(data.marked_at).getTime() : Date.now();

    if (markMs < new Date(startsAt).getTime()) {
      throw new Error("A chamada ainda não foi aberta. Aguarde o horário definido pelo professor.");
    }
    if (!codeOpenAt(startsAt, codeWindowMinutes, closedAt, markMs)) {
      throw new Error(
        "A presença desta aula está encerrada. Você ainda pode enviar uma justificativa de falta.",
      );
    }

    const { data: enroll } = await supabaseAdmin
      .from("discipline_students")
      .select("id")
      .eq("discipline_id", session.discipline_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (!enroll) throw new Error("Você não está matriculado nesta disciplina");

    const { error: upErr } = await supabaseAdmin.from("attendance_records").upsert(
      {
        session_id: data.session_id,
        student_id: context.userId,
        status: "present" as const,
        confirmed_at: new Date(markMs).toISOString(),
      },
      { onConflict: "session_id,student_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/** Professor encerra manualmente a janela de presença (código/QR deixam de valer). */
export const closeAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ session_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("teacher_id, starts_at, created_at, closed_at")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    if (session.teacher_id !== context.userId) throw new Error("Sem permissão");
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    if (Date.now() < new Date(startsAt).getTime()) {
      throw new Error("Esta chamada ainda não foi iniciada.");
    }
    if ((session as { closed_at?: string | null }).closed_at) return { ok: true };
    const { data: updated, error } = await supabaseAdmin
      .from("attendance_sessions")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", data.session_id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Student submits absence justification. */
export const submitJustification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        reason: z.enum([
          "work_shift",
          "student_illness",
          "family_illness",
          "variable_schedule",
          "personal_emergency",
        ]),
        description: z.string().trim().max(30000).optional(),
        attachment_url: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("*")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    const codeWindowMinutes = session.code_window_minutes ?? CODE_WINDOW_MINUTES_DEFAULT;
    const closedAt = (session as { closed_at?: string | null }).closed_at ?? null;
    if (codeOpenAt(startsAt, codeWindowMinutes, closedAt, Date.now())) {
      throw new Error(
        "O código de presença ainda está aberto. Use o código para registrar presença.",
      );
    }
    if (!justificationOpen(startsAt, codeWindowMinutes, closedAt, session.window_hours)) {
      throw new Error(`Janela de ${JUSTIFICATION_HOURS}h para justificar falta encerrada`);
    }

    const { data: rec } = await supabaseAdmin
      .from("attendance_records")
      .select("status")
      .eq("session_id", data.session_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (rec?.status === "present") throw new Error("Sua presença já foi confirmada nesta aula");

    const { error } = await supabaseAdmin.from("justifications").upsert(
      {
        session_id: data.session_id,
        student_id: context.userId,
        reason: data.reason,
        description: data.description ?? null,
        attachment_url: data.attachment_url ?? null,
        status: "pending" as const,
      },
      { onConflict: "session_id,student_id" },
    );
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/** Teacher reviews a justification (approve/reject). */
export const reviewJustification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        justification_id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(30000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: just } = await supabaseAdmin
      .from("justifications")
      .select("*, attendance_sessions(discipline_id, teacher_id)")
      .eq("id", data.justification_id)
      .maybeSingle();

    if (!just) throw new Error("Justificativa não encontrada");
    const session = (just as any).attendance_sessions;
    if (!session) throw new Error("Sessão não encontrada");

    await assertTeacher(session.discipline_id, context.userId);

    const { error: updErr } = await supabaseAdmin
      .from("justifications")
      .update({
        status: data.decision,
        review_note: data.note ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      })
      .eq("id", data.justification_id);
    if (updErr) throw new Error(updErr.message);

    if (data.decision === "approved") {
      await supabaseAdmin.from("attendance_records").upsert(
        {
          session_id: just.session_id,
          student_id: just.student_id,
          status: "justified",
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: "session_id,student_id" },
      );
    }

    await notifyUsers(
      [just.student_id],
      "justification_decision",
      `Justificativa ${data.decision === "approved" ? "aprovada" : "rejeitada"}`,
      `Sua justificativa para a aula de ${new Date(session.starts_at).toLocaleDateString("pt-BR")} foi ${data.decision === "approved" ? "aprovada" : "rejeitada"}.`,
      `/disciplines/${session.discipline_id}`,
    );

    return { ok: true };
  });

/** Bulk update attendance for all students in a session. */
export const bulkUpdateAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        status: z.enum(["present", "absent", "justified"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("discipline_id")
      .eq("id", data.session_id)
      .maybeSingle();

    if (!session) throw new Error("Sessão não encontrada");
    await assertTeacher(session.discipline_id, context.userId);

    // Get all enrolled students
    const { data: enrollments } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", session.discipline_id)
      .eq("status", "active");

    if (!enrollments || enrollments.length === 0) return { ok: true, count: 0 };

    const records = enrollments.map((e) => ({
      session_id: data.session_id,
      student_id: e.student_id,
      status: data.status,
      confirmed_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from("attendance_records")
      .upsert(records, { onConflict: "session_id,student_id" });

    if (error) throw new Error(error.message);

    return { ok: true, count: records.length };
  });

/** Teacher updates discipline attendance settings. */
export const updateDisciplineSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        discipline_id: z.string().uuid(),
        justified_counts_as_presence: z.boolean(),
        min_attendance_percent: z.number().min(0).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("discipline_settings").upsert(
      {
        discipline_id: data.discipline_id,
        justified_counts_as_presence: data.justified_counts_as_presence,
        min_attendance_percent: data.min_attendance_percent,
      },
      { onConflict: "discipline_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Teacher updates an existing session. */
export const updateAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        topic: z.string().trim().max(200).optional(),
        starts_at: z.string().datetime().optional(),
        session_date: z.string().optional(),
        code_window_minutes: z.number().int().min(CODE_WINDOW_MIN).max(CODE_WINDOW_MAX).optional(),
        programmatic_content: z.string().trim().optional(),
        pedagogical_observations: z.string().trim().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("*")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    if (session.teacher_id !== context.userId) throw new Error("Sem permissão");
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    const started = hasStarted(startsAt);
    
    const patch: any = {};
    if (data.topic !== undefined) patch.topic = data.topic;
    if (data.programmatic_content !== undefined) patch.programmatic_content = data.programmatic_content;
    if (data.pedagogical_observations !== undefined) patch.pedagogical_observations = data.pedagogical_observations;

    if (started && (data.starts_at !== undefined || data.code_window_minutes !== undefined)) {
      throw new Error("Esta chamada já foi iniciada: campos de horário não podem ser alterados.");
    }
    
    if (data.starts_at !== undefined) {
      patch.starts_at = data.starts_at;
      patch.session_date = data.session_date ?? datePartFromIso(data.starts_at);
    } else if (data.session_date !== undefined) {
      patch.session_date = data.session_date;
    }
    if (data.code_window_minutes !== undefined)
      patch.code_window_minutes = data.code_window_minutes;
      
    const { data: updated, error } = await supabaseAdmin
      .from("attendance_sessions")
      .update(patch)
      .eq("id", data.session_id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Alterna o status de presença de um aluno circularmente: P -> F -> J -> SD -> P */
export const cycleAttendanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    session_id: z.string().uuid(),
    student_id: z.string().uuid(),
    current_status: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("discipline_id, teacher_id")
      .eq("id", data.session_id)
      .single();
    if (!session) throw new Error("Sessão não encontrada");
    await assertTeacher(session.discipline_id, context.userId);

    const statuses: any[] = ["present", "absent", "justified", "no_class"];
    let nextIndex = 0;
    if (data.current_status) {
      const idx = statuses.indexOf(data.current_status);
      nextIndex = (idx + 1) % statuses.length;
    }

    const { error } = await supabaseAdmin.from("attendance_records").upsert({
      session_id: data.session_id,
      student_id: data.student_id,
      status: statuses[nextIndex],
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id,student_id" });

    if (error) throw new Error(error.message);
    return { status: statuses[nextIndex] };
  });

/**
 * Define explicitamente o status de presença de um aluno em uma sessão.
 * Roda no servidor (bypass de RLS) após validar que o usuário é professor
 * da disciplina ou admin — evita rejeições de RLS na grade de frequência.
 */
export const setAttendanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        student_id: z.string().uuid(),
        status: z.enum(["present", "absent", "justified", "no_class"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("discipline_id")
      .eq("id", data.session_id)
      .single();
    if (!session) throw new Error("Sessão não encontrada");
    await assertTeacher(session.discipline_id, context.userId);

    const { error } = await supabaseAdmin.from("attendance_records").upsert(
      {
        session_id: data.session_id,
        student_id: data.student_id,
        status: data.status,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,student_id" },
    );
    if (error) throw new Error(error.message);
    return { status: data.status };
  });

/** Marca datas como 'Sem Aula' (SD) em lote para a disciplina. */
export const markNoClassDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    dates: z.array(z.string()), // ['YYYY-MM-DD']
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    
    // Para cada data, se não existir sessão, cria uma sessão 'Feriado/Sem Aula'
    for (const d of data.dates) {
      const { data: session, error } = await supabaseAdmin
        .from("attendance_sessions")
        .insert({
          discipline_id: data.discipline_id,
          teacher_id: context.userId,
          topic: "Sem Aula / Feriado",
          session_date: d,
          starts_at: new Date(Number(d.split("-")[0]), Number(d.split("-")[1]) - 1, Number(d.split("-")[2]), 8, 0, 0).toISOString(),
          code: "SD-CODE", // Código placeholder
          window_hours: 0,
          code_window_minutes: 0,
          finalized_at: new Date().toISOString(),
        } as any)
        .select("id")
        .single();
      
      if (error) continue;

      // Marca todos os alunos como 'no_class'
      const { data: students } = await supabaseAdmin
        .from("discipline_students")
        .select("student_id")
        .eq("discipline_id", data.discipline_id)
        .eq("status", "active");
      
      if (students && students.length > 0) {
        const records = students.map(s => ({
          session_id: session.id,
          student_id: s.student_id,
          status: "no_class",
        }));
        await supabaseAdmin.from("attendance_records").insert(records as any);
      }
    }
    return { ok: true };
  });

/** Teacher deletes a session before it starts. */
export const deleteAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ session_id: z.string().uuid(), force: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("teacher_id, starts_at, created_at")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    if (session.teacher_id !== context.userId) throw new Error("Sem permissão");
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    void startsAt;

    if (!data.force) {
      const { count: presentCount } = await supabaseAdmin
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("session_id", data.session_id)
        .neq("status", "absent");
      if ((presentCount ?? 0) > 0) {
        throw new Error("Não é possível excluir: há presenças registradas nesta chamada.");
      }
      const { count: justCount } = await supabaseAdmin
        .from("justifications")
        .select("id", { count: "exact", head: true })
        .eq("session_id", data.session_id);
      if ((justCount ?? 0) > 0) {
        throw new Error("Não é possível excluir: há justificativas associadas a esta chamada.");
      }
    }

    await supabaseAdmin.from("justifications").delete().eq("session_id", data.session_id);
    await supabaseAdmin.from("attendance_records").delete().eq("session_id", data.session_id);
    const { error } = await supabaseAdmin
      .from("attendance_sessions")
      .delete()
      .eq("id", data.session_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Teacher finalizes a session after the 48h attendance/justification window closes. */
export const finalizeAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ session_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("teacher_id, discipline_id, starts_at, created_at, window_hours, finalized_at")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    if (session.teacher_id !== context.userId) throw new Error("Sem permissão");
    if (session.finalized_at) return { ok: true };
    const startsAt = (session as { starts_at?: string }).starts_at ?? session.created_at;
    if (!hasWindowEnded(startsAt, session.window_hours)) {
      throw new Error("A chamada só pode ser finalizada após o encerramento da janela de 48h.");
    }
    const { count: pendingCount } = await supabaseAdmin
      .from("justifications")
      .select("id", { count: "exact", head: true })
      .eq("session_id", data.session_id)
      .eq("status", "pending");
    if ((pendingCount ?? 0) > 0) {
      throw new Error("Revise todas as justificativas pendentes antes de finalizar a chamada.");
    }
    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", session.discipline_id)
      .eq("status", "active");
    if (enrolled?.length) {
      await supabaseAdmin.from("attendance_records").upsert(
        enrolled.map((e) => ({
          session_id: data.session_id,
          student_id: e.student_id,
          status: "absent" as const,
        })),
        { onConflict: "session_id,student_id", ignoreDuplicates: true },
      );
    }
    const { error } = await supabaseAdmin
      .from("attendance_sessions")
      .update({ finalized_at: new Date().toISOString(), finalized_by: context.userId })
      .eq("id", data.session_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Teacher reveals the code on demand. Only returned to the discipline's teacher. */
export const revealAttendanceCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ session_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("attendance_sessions")
      .select("code, teacher_id")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Sessão não encontrada");
    if (session.teacher_id !== context.userId) throw new Error("Sem permissão");
    return { code: session.code };
  });

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const STATUS_LABEL: Record<string, string> = {
  present: "Presente",
  justified: "Falta justificada",
  absent: "Falta",
};

/**
 * Professor exporta a frequência da disciplina em CSV (matriz aluno × aula),
 * opcionalmente filtrada por um período de datas (session_date, America/Sao_Paulo).
 */
export const exportAttendanceCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        discipline_id: z.string().uuid(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);

    let sessQuery = supabaseAdmin
      .from("attendance_sessions")
      .select("id, topic, session_date, starts_at, created_at")
      .eq("discipline_id", data.discipline_id)
      .order("session_date", { ascending: true })
      .order("starts_at", { ascending: true });
    if (data.from) sessQuery = sessQuery.gte("session_date", data.from);
    if (data.to) sessQuery = sessQuery.lte("session_date", data.to);
    const { data: sessions, error: sErr } = await sessQuery;
    if (sErr) throw new Error(sErr.message);

    const sessionList = sessions ?? [];
    const sessionIds = sessionList.map((s) => s.id);

    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id)
      .eq("status", "active");
    const studentIds = (enrolled ?? []).map((e) => e.student_id);

    const { data: profiles } = studentIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, name, enrollment_number")
          .in("id", studentIds)
      : { data: [] as { id: string; name: string; enrollment_number: string | null }[] };
    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p]),
    );

    const { data: records } = sessionIds.length
      ? await supabaseAdmin
          .from("attendance_records")
          .select("session_id, student_id, status")
          .in("session_id", sessionIds)
      : { data: [] as { session_id: string; student_id: string; status: string }[] };
    const recMap = new Map<string, string>();
    for (const r of records ?? []) recMap.set(`${r.session_id}:${r.student_id}`, r.status);

    const dateLabel = (s: (typeof sessionList)[number]) => {
      const [y, m, d] = s.session_date.split("-");
      return `${d}/${m}/${y}`;
    };

    const header = [
      "Matrícula",
      "Aluno",
      ...sessionList.map((s) => `${dateLabel(s)}${s.topic ? ` - ${s.topic}` : ""}`),
      "Presenças",
      "Frequência (%)",
    ];

    const sortedStudents = [...studentIds].sort((a, b) => {
      const na = profileMap.get(a)?.name ?? "";
      const nb = profileMap.get(b)?.name ?? "";
      return na.localeCompare(nb, "pt-BR");
    });

    const rows = sortedStudents.map((sid) => {
      const p = profileMap.get(sid);
      let present = 0;
      const cells = sessionList.map((s) => {
        const st = recMap.get(`${s.id}:${sid}`) ?? "absent";
        if (st === "present" || st === "justified") present += 1;
        return STATUS_LABEL[st] ?? st;
      });
      const total = sessionList.length;
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      return [
        p?.enrollment_number ?? "",
        p?.name ?? "—",
        ...cells,
        `${present}/${total}`,
        String(pct).replace(".", ","),
      ];
    });

    const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
    const csv = "\uFEFF" + lines.join("\r\n");
    return { csv, sessionCount: sessionList.length, studentCount: sortedStudents.length };
  });
