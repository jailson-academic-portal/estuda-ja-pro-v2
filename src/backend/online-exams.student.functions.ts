import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  AttendanceSessionRef,
  ExamSessionStatus,
  OnlineExamForStudentListItem,
  OnlineExamForStudentSession,
  OnlineExamQuestionForStudent,
} from "@/integrations/supabase/online-exams.types";

/* ============================================================================
 * AVALIAÇÕES ONLINE — funções do aluno
 *
 * Padrão: server fn + supabaseAdmin + RLS bypass + checagem manual de que o
 * aluno pertence à disciplina. O gabarito NUNCA trafega para o cliente:
 * `assessment_questions.correct_answer` é lido pelo servidor mas descartado.
 *
 * Status de fluxo (exam_sessions):
 *   not_started / in_progress → aluno pode iniciar/retomar e enviar.
 *   submitted / graded       → aluno pode apenas ver a tela de conclusão.
 *   invalidated              → acesso bloqueado.
 * ========================================================================== */

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Janela atual coerente: aberta E dentro de opens_at..closes_at. */
function computeInWindow(
  opens_at: string | null,
  closes_at: string | null,
  status: string,
  now: Date,
): { inWindow: boolean; label: string | null } {
  if (status !== "open") {
    return { inWindow: false, label: null };
  }
  if (opens_at && new Date(opens_at).getTime() > now.getTime()) {
    return { inWindow: false, label: `Disponível em ${formatDate(opens_at)}` };
  }
  if (closes_at && new Date(closes_at).getTime() < now.getTime()) {
    return { inWindow: false, label: "Prazo encerrado" };
  }
  return { inWindow: true, label: null };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Garante que o aluno está matriculado na disciplina do exame. */
async function assertStudentOwnsExam(examId: string, userId: string) {
  const { data: exam, error: eErr } = await supabaseAdmin
    .from("online_exams")
    .select(
      "id, discipline_id, status, opens_at, closes_at, time_limit_minutes, allow_resume, title",
    )
    .eq("id", examId)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);
  if (!exam) throw new Error("Avaliação online não encontrada");

  const { data: enrolled, error: enErr } = await supabaseAdmin
    .from("discipline_students")
    .select("student_id")
    .eq("discipline_id", (exam as { discipline_id: string }).discipline_id)
    .eq("student_id", userId)
    .maybeSingle();
  if (enErr) throw new Error(enErr.message);
  if (!enrolled) throw new Error("Você não está matriculado nesta disciplina");
  return exam as {
    id: string;
    discipline_id: string;
    status: string;
    opens_at: string | null;
    closes_at: string | null;
    time_limit_minutes: number;
    allow_resume: boolean;
    title: string;
  };
}

/** Retorna a sessão ativa do aluno para esta prova (ou null). */
async function getActiveOrSubmittedSession(examId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("exam_sessions")
    .select("id, status, attempt_number, started_at, last_activity_at, submitted_at, expires_at")
    .eq("exam_id", examId)
    .eq("student_id", userId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Verifica se o aluno tem presenca confirmada ('present') no
 * Diario Digital para liberar uma prova. Duas estrategias:
 *
 *  1. **Vinculo explicito** (regra atual, preferida): se a prova
 *     tem `attendance_session_id` preenchido, basta o aluno ter
 *     presenca NESTA chamada especifica. O proprio aluno
 *     registra a presenca via QR Code ou codigo de 6 letras no
 *     proprio sistema, e a sala e destravada automaticamente.
 *
 *  2. **Fallback por janela** (legado, provas sem vinculo): se a
 *     prova nao tem `attendance_session_id`, procuramos qualquer
 *     chamada da disciplina dentro da janela opens_at..closes_at
 *     em que o aluno tenha presenca marcada.
 *
 * Retorna o resumo da aula que liberou a prova, ou null.
 */
async function findAttendanceRecordForExam(
  examId: string,
  disciplineId: string,
  studentId: string,
  opensAt: string | null,
  closesAt: string | null,
  now: Date,
): Promise<AttendanceSessionRef | null> {
  // 1) Carrega a prova com o vinculo de chamada (se houver)
  const { data: exam, error: eErr } = await supabaseAdmin
    .from("online_exams")
    .select("attendance_session_id")
    .eq("id", examId)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);

  const linkedSessionId =
    (exam as { attendance_session_id?: string | null } | null)?.attendance_session_id ?? null;

  if (linkedSessionId) {
    // Estrategia principal: presenca NESTA chamada
    const { data: sess, error: sErr } = await supabaseAdmin
      .from("attendance_sessions")
      .select("id, topic, session_date, starts_at, discipline_id")
      .eq("id", linkedSessionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!sess) return null;
    if ((sess as { discipline_id: string }).discipline_id !== disciplineId) {
      // Defesa em profundidade: o id nao pode apontar para outra disciplina
      return null;
    }
    const { data: rec, error: rErr } = await supabaseAdmin
      .from("attendance_records")
      .select("status")
      .eq("session_id", linkedSessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rec || (rec as { status: string }).status !== "present") return null;
    return {
      id: sess.id as string,
      topic: (sess.topic as string | null) ?? null,
      session_date: sess.session_date as string,
      starts_at: sess.starts_at as string,
    };
  }

  // 2) Fallback (legado): qualquer chamada da disciplina dentro
  //    da janela opens_at..closes_at em que o aluno marcou 'present'.
  const floor = opensAt
    ? new Date(opensAt).toISOString()
    : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ceiling = closesAt
    ? new Date(closesAt).toISOString()
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sessions, error: sErr2 } = await supabaseAdmin
    .from("attendance_sessions")
    .select("id, topic, session_date, starts_at")
    .eq("discipline_id", disciplineId)
    .gte("starts_at", floor)
    .lte("starts_at", ceiling)
    .order("starts_at", { ascending: false })
    .limit(20);
  if (sErr2) throw new Error(sErr2.message);
  if (!sessions || sessions.length === 0) return null;

  const sessionIds = sessions.map((s) => s.id as string);
  const { data: records, error: rErr2 } = await supabaseAdmin
    .from("attendance_records")
    .select("session_id")
    .eq("student_id", studentId)
    .eq("status", "present")
    .in("session_id", sessionIds);
  if (rErr2) throw new Error(rErr2.message);
  const presentIds = new Set((records ?? []).map((r) => r.session_id as string));
  if (presentIds.size === 0) return null;

  const match = sessions.find((s) => presentIds.has(s.id as string));
  if (!match) return null;
  return {
    id: match.id as string,
    topic: (match.topic as string | null) ?? null,
    session_date: match.session_date as string,
    starts_at: match.starts_at as string,
  };
}

/* ============================================================================
 * LISTAR — avaliações disponíveis para o aluno
 *
 * Critérios:
 *  - status = 'open'
 *  - aluno matriculado na disciplina
 *  - dentro da janela opens_at..closes_at (status dinâmico)
 * Retorna também sessões existentes (para diferenciar "Iniciar" vs "Retomar")
 * e, para cada prova, se o aluno tem presenca no Diario Digital dentro da
 * janela — pre-requisito para liberar a sala.
 * ========================================================================== */
export const listOnlineExamsForStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;

    // 1) Disciplinas em que o aluno está matriculado e ativo
    const { data: enrollments, error: enErr } = await supabaseAdmin
      .from("discipline_students")
      .select("discipline_id, disciplines:discipline_id(id, name)")
      .eq("student_id", userId)
      .eq("status", "active");
    if (enErr) throw new Error(enErr.message);
    const disciplineIds = (enrollments ?? [])
      .map((e: { discipline_id: string }) => e.discipline_id)
      .filter(isUuid);
    if (disciplineIds.length === 0) return [];

    // 2) Provas abertas dessas disciplinas
    const { data: exams, error: exErr } = await supabaseAdmin
      .from("online_exams")
      .select(
        "id, title, discipline_id, status, opens_at, closes_at, time_limit_minutes, max_score, assessment_id, attendance_session_id",
      )
      .in("discipline_id", disciplineIds)
      .eq("status", "open")
      .order("closes_at", { ascending: true, nullsFirst: false });
    if (exErr) throw new Error(exErr.message);
    if (!exams || exams.length === 0) return [];

    // 3) Contagem de questões por prova
    const assessmentIds = [
      ...new Set(exams.map((e: { assessment_id: string }) => e.assessment_id).filter(isUuid)),
    ];
    const questionCount = new Map<string, number>();
    if (assessmentIds.length) {
      const { data: qs, error: qErr } = await supabaseAdmin
        .from("assessment_questions")
        .select("assessment_id")
        .in("assessment_id", assessmentIds);
      if (qErr) throw new Error(qErr.message);
      for (const q of qs ?? []) {
        const k = q.assessment_id as string;
        questionCount.set(k, (questionCount.get(k) ?? 0) + 1);
      }
    }

    // 4) Sessões existentes do aluno para essas provas
    const examIds = (exams as Array<{ id: string }>).map((e) => e.id);
    const sessionByExam = new Map<string, ExamSessionStatus>();
    if (examIds.length) {
      const { data: sessions, error: sErr } = await supabaseAdmin
        .from("exam_sessions")
        .select("exam_id, status")
        .eq("student_id", userId)
        .in("exam_id", examIds);
      if (sErr) throw new Error(sErr.message);
      for (const s of sessions ?? []) {
        // prioriza status "mais avançado"
        const existing = sessionByExam.get(s.exam_id as string);
        const next = s.status as ExamSessionStatus;
        if (!existing || severity(next) > severity(existing)) {
          sessionByExam.set(s.exam_id as string, next);
        }
      }
    }

    // 5) Disciplinas (nome) — pré-carregadas acima, monta mapa
    const disciplineName = new Map<string, string>();
    for (const e of enrollments ?? []) {
      const d = (e as { disciplines?: { id: string; name: string } | null }).disciplines;
      if (d) disciplineName.set(d.id, d.name);
    }

    // 6) Presenca por disciplina: carrega TODAS as aulas dessas disciplinas
    //    em que o aluno marcou 'present', e deixa a funcao `hasAttendanceIn`
    //    checar contra a janela de cada prova (em memoria). Custo: 1 query
    //    por disciplina em vez de N por prova.
    const now = new Date();
    const attendanceSessionsByDiscipline = new Map<
      string,
      Array<{ id: string; starts_at: string }>
    >();
    if (disciplineIds.length) {
      const { data: recs, error: rErr } = await supabaseAdmin
        .from("attendance_records")
        .select("session_id, status, attendance_sessions:session_id(id, discipline_id, starts_at)")
        .eq("student_id", userId)
        .eq("status", "present");
      if (rErr) throw new Error(rErr.message);
      for (const r of recs ?? []) {
        const sess = (
          r as {
            attendance_sessions?: { id: string; discipline_id: string; starts_at: string } | null;
          }
        ).attendance_sessions;
        if (!sess) continue;
        const arr = attendanceSessionsByDiscipline.get(sess.discipline_id) ?? [];
        arr.push({ id: sess.id, starts_at: sess.starts_at });
        attendanceSessionsByDiscipline.set(sess.discipline_id, arr);
      }
    }

    const hasAttendanceIn = (
      disciplineId: string,
      opensAt: string | null,
      closesAt: string | null,
    ): boolean => {
      const list = attendanceSessionsByDiscipline.get(disciplineId);
      if (!list || list.length === 0) return false;
      const floor = opensAt ? new Date(opensAt).getTime() : now.getTime() - 24 * 60 * 60 * 1000;
      const ceiling = closesAt
        ? new Date(closesAt).getTime()
        : now.getTime() + 30 * 24 * 60 * 60 * 1000;
      for (const s of list) {
        const t = new Date(s.starts_at).getTime();
        if (t >= floor && t <= ceiling) return true;
      }
      return false;
    };

    // 6b) Presenca por sessao vinculada: para cada prova com
    //     attendance_session_id preenchido, checa direto em
    //     attendance_records. Custo: 1 query para todas as provas
    //     com vinculo, em vez de N por prova.
    const linkedSessionIds = Array.from(
      new Set(
        (exams as Array<{ attendance_session_id: string | null }>)
          .map((e) => e.attendance_session_id)
          .filter((v): v is string => !!v),
      ),
    );
    const hasPresentInLinkedSession = new Set<string>();
    if (linkedSessionIds.length) {
      const { data: recs, error: rErr2 } = await supabaseAdmin
        .from("attendance_records")
        .select("session_id")
        .eq("student_id", userId)
        .eq("status", "present")
        .in("session_id", linkedSessionIds);
      if (rErr2) throw new Error(rErr2.message);
      for (const r of recs ?? []) {
        hasPresentInLinkedSession.add(r.session_id as string);
      }
    }

    const out: OnlineExamForStudentListItem[] = (
      exams as unknown as Array<{
        id: string;
        title: string;
        discipline_id: string;
        status: string;
        opens_at: string | null;
        closes_at: string | null;
        time_limit_minutes: number;
        max_score: string;
        assessment_id: string;
        attendance_session_id: string | null;
      }>
    ).map((e) => {
      const win = computeInWindow(e.opens_at, e.closes_at, e.status, now);
      const sessStatus = sessionByExam.get(e.id) ?? null;
      const isClosed = sessStatus === "submitted" || sessStatus === "graded";
      // Provas ja submetidas/graded nao exigem nova presenca: o aluno ja
      // passou pelo gate, e a exibicao e' so de resultado.
      let hasAtt: boolean;
      if (isClosed) {
        hasAtt = true;
      } else if (e.attendance_session_id) {
        // Regra principal: presenca NESTA chamada especifica
        hasAtt = hasPresentInLinkedSession.has(e.attendance_session_id);
      } else {
        // Fallback (legado, prova sem vinculo)
        hasAtt = hasAttendanceIn(e.discipline_id, e.opens_at, e.closes_at);
      }
      return {
        id: e.id,
        title: e.title,
        discipline_id: e.discipline_id,
        discipline_name: disciplineName.get(e.discipline_id) ?? null,
        status: e.status as OnlineExamForStudentListItem["status"],
        opens_at: e.opens_at,
        closes_at: e.closes_at,
        time_limit_minutes: e.time_limit_minutes,
        max_score: e.max_score,
        question_count: questionCount.get(e.assessment_id) ?? 0,
        session_status: sessStatus,
        in_window: win.inWindow,
        availability_label: win.label,
        has_attendance: hasAtt,
      };
    });

    // Pendentes primeiro; submetidas/graded no fim.
    return out.sort((a, b) => {
      const aClosed = a.session_status === "submitted" || a.session_status === "graded";
      const bClosed = b.session_status === "submitted" || b.session_status === "graded";
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
  });

/** Peso numérico para ordenar "qual status é mais recente / avançado". */
function severity(s: ExamSessionStatus): number {
  switch (s) {
    case "invalidated":
      return 5;
    case "graded":
      return 4;
    case "submitted":
      return 3;
    case "in_progress":
      return 2;
    case "not_started":
      return 1;
    default:
      return 0;
  }
}

/* ============================================================================
 * CARREGAR PROVA PARA O ALUNO
 *
 * - Confere matrícula na disciplina
 * - Confere janela de horário (server-side defense in depth — RLS não
 *   expressa essa regra sozinha)
 * - Cria ou recupera a sessão (not_started/in_progress)
 * - Retorna as questões SEM gabarito
 * ========================================================================== */
export const getOnlineExamForStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ examId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OnlineExamForStudentSession> => {
    const userId = context.userId;
    const exam = await assertStudentOwnsExam(data.examId, userId);

    const now = new Date();
    const win = computeInWindow(exam.opens_at, exam.closes_at, exam.status, now);
    // Permite carregar uma prova já submetida (visualização) mesmo fora dela.
    const existingSession = await getActiveOrSubmittedSession(exam.id, userId);
    const closedForStudent =
      existingSession &&
      (existingSession.status === "submitted" ||
        existingSession.status === "graded" ||
        existingSession.status === "invalidated");

    if (!win.inWindow && !closedForStudent) {
      throw new Error(win.label ?? "A prova não está disponível no momento");
    }

    // Nome da disciplina + assessment
    const { data: discRow, error: dErr } = await supabaseAdmin
      .from("disciplines")
      .select("id, name")
      .eq("id", exam.discipline_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);

    const { data: fullExam, error: fErr } = await supabaseAdmin
      .from("online_exams")
      .select(
        "id, title, instructions, assessment_id, discipline_id, time_limit_minutes, max_score, opens_at, closes_at, allow_resume",
      )
      .eq("id", exam.id)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!fullExam) throw new Error("Prova indisponível");
    const fullExamRow = fullExam as unknown as {
      id: string;
      title: string;
      instructions: string | null;
      assessment_id: string;
      discipline_id: string;
      time_limit_minutes: number;
      max_score: number;
      opens_at: string | null;
      closes_at: string | null;
      allow_resume: boolean;
    };
    const disc = discRow as { name?: string } | null;

    // Cria ou recupera sessão
    type SessionLite = {
      id: string;
      status: ExamSessionStatus;
      started_at: string | null;
      expires_at: string | null;
    };
    let sessionRow: SessionLite | null = (existingSession as SessionLite | null) ?? null;

    if (!sessionRow) {
      const startedAt = new Date().toISOString();
      const expiresAt = new Date(now.getTime() + exam.time_limit_minutes * 60 * 1000).toISOString();
      const { data: created, error: cErr } = await supabaseAdmin
        .from("exam_sessions")
        .insert({
          exam_id: exam.id,
          student_id: userId,
          attempt_number: 1,
          status: "in_progress",
          started_at: startedAt,
          last_activity_at: startedAt,
          expires_at: expiresAt,
        })
        .select("id, status, started_at, expires_at")
        .single();
      if (cErr) throw new Error(cErr.message);
      sessionRow = created as unknown as SessionLite;
    } else if (sessionRow.status === "not_started") {
      const startedAt = new Date().toISOString();
      const expiresAt = new Date(now.getTime() + exam.time_limit_minutes * 60 * 1000).toISOString();
      const { data: updated, error: uErr } = await supabaseAdmin
        .from("exam_sessions")
        .update({
          status: "in_progress",
          started_at: startedAt,
          last_activity_at: startedAt,
          expires_at: expiresAt,
        })
        .eq("id", sessionRow.id)
        .select("id, status, started_at, expires_at")
        .single();
      if (uErr) throw new Error(uErr.message);
      sessionRow = updated as unknown as SessionLite;
    } else if (
      sessionRow.status === "in_progress" &&
      exam.allow_resume &&
      sessionRow.expires_at &&
      new Date(sessionRow.expires_at).getTime() < now.getTime()
    ) {
      // Tempo esgotado — atualiza para expirar a sessão.
      const { data: updated, error: uErr } = await supabaseAdmin
        .from("exam_sessions")
        .update({ status: "invalidated" })
        .eq("id", sessionRow.id)
        .select("id, status, started_at, expires_at")
        .single();
      if (uErr) throw new Error(uErr.message);
      sessionRow = updated as unknown as SessionLite;
    }

    if (!sessionRow) throw new Error("Não foi possível iniciar a sessão");

    // Carrega questões (SEM correct_answer)
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("assessment_questions")
      .select("id, position, qtype, prompt, options, weight")
      .eq("assessment_id", fullExamRow.assessment_id)
      .order("position", { ascending: true });
    if (qErr) throw new Error(qErr.message);

    const questions: OnlineExamQuestionForStudent[] = (qs ?? []).map((q: unknown) => {
      const row = q as {
        id: string;
        position: number;
        qtype: string;
        prompt: string;
        options: unknown;
        weight: number | string;
      };
      // options pode vir como array de {id, label, is_correct?} ou como string.
      const raw = row.options;
      const parsed = typeof raw === "string" ? safeJson(raw) : raw;
      const opts = Array.isArray(parsed) ? parsed : [];
      return {
        id: row.id,
        position: row.position,
        qtype: row.qtype,
        prompt: row.prompt,
        options: opts
          .map((o: unknown, idx: number) => normalizeOption(o, idx))
          .filter((x): x is { id: string; label: string } => x !== null),
        weight: String(row.weight ?? 1),
      };
    });

    // Respostas já gravadas (para retomar)
    let existingAnswers: OnlineExamForStudentSession["session"]["existing_answers"] = [];
    if (exam.allow_resume && sessionRow.status === "in_progress") {
      const { data: ans, error: aErr } = await supabaseAdmin
        .from("exam_answers")
        .select("question_id, answer, flagged")
        .eq("session_id", sessionRow.id);
      if (aErr) throw new Error(aErr.message);
      existingAnswers = (ans ?? []).map(
        (r: { question_id: string; answer: unknown; flagged: boolean }) => ({
          question_id: r.question_id,
          selected_option_id: extractSelectedOptionId(r.answer),
          flagged: !!r.flagged,
        }),
      );
    } else if (sessionRow.status === "submitted" || sessionRow.status === "graded") {
      const { data: ans, error: aErr } = await supabaseAdmin
        .from("exam_answers")
        .select("question_id, answer, flagged")
        .eq("session_id", sessionRow.id);
      if (aErr) throw new Error(aErr.message);
      existingAnswers = (ans ?? []).map(
        (r: { question_id: string; answer: unknown; flagged: boolean }) => ({
          question_id: r.question_id,
          selected_option_id: extractSelectedOptionId(r.answer),
          flagged: !!r.flagged,
        }),
      );
    }

    return {
      exam: {
        id: fullExamRow.id,
        title: fullExamRow.title,
        instructions: fullExamRow.instructions,
        discipline_id: fullExamRow.discipline_id,
        discipline_name: disc?.name ?? null,
        time_limit_minutes: fullExamRow.time_limit_minutes,
        max_score: String(fullExamRow.max_score),
        opens_at: fullExamRow.opens_at,
        closes_at: fullExamRow.closes_at,
        expires_at: sessionRow.expires_at,
      },
      session: {
        session_id: sessionRow.id,
        exam_id: exam.id,
        status: sessionRow.status,
        started_at: sessionRow.started_at,
        expires_at: sessionRow.expires_at,
        existing_answers: existingAnswers,
      },
      questions,
    };
  });

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Normaliza uma opção: o banco pode guardar como {id,label,is_correct?}
 * ou como {letter, text} ou como string. Devolve só {id,label}. */
function normalizeOption(o: unknown, idx: number): { id: string; label: string } | null {
  if (typeof o === "string") {
    return { id: `opt-${idx}`, label: o };
  }
  if (o && typeof o === "object") {
    const obj = o as Record<string, unknown>;
    const id =
      typeof obj.id === "string"
        ? obj.id
        : typeof obj.value === "string"
          ? obj.value
          : `opt-${idx}`;
    const label =
      typeof obj.label === "string"
        ? obj.label
        : typeof obj.text === "string"
          ? obj.text
          : typeof obj.value === "string" && typeof obj.id === "string"
            ? obj.value
            : JSON.stringify(obj);
    return { id, label };
  }
  return null;
}

/** Extrai o `selected` salvo em exam_answers.answer para retomar. */
function extractSelectedOptionId(answer: unknown): string | null {
  if (!answer) return null;
  if (typeof answer === "string") {
    const j = safeJson(answer);
    return extractSelectedOptionId(j);
  }
  if (typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    if (typeof obj.selected === "string") return obj.selected;
    if (Array.isArray(obj.selected) && typeof obj.selected[0] === "string") return obj.selected[0];
  }
  return null;
}

/* ============================================================================
 * SUBMETER — grava respostas e fecha a sessão
 *
 * Body:
 *   { sessionId, answers: [{questionId, selectedOptionId, flagged}] }
 * ========================================================================== */
export const submitOnlineExamForStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        examId: z.string().uuid(),
        answers: z
          .array(
            z.object({
              questionId: z.string().uuid(),
              selectedOptionId: z.string().nullish(),
              flagged: z.boolean().optional(),
            }),
          )
          .max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { sessionId, examId, answers } = data;

    // Confere que a sessão pertence ao aluno e à prova certa.
    const { data: session, error: sErr } = await supabaseAdmin
      .from("exam_sessions")
      .select("id, exam_id, student_id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!session) throw new Error("Sessão não encontrada");
    if ((session as { student_id: string }).student_id !== userId) {
      throw new Error("Você não tem acesso a esta sessão");
    }
    if ((session as { exam_id: string }).exam_id !== examId) {
      throw new Error("Sessão não corresponde à prova");
    }
    const status = (session as { status: string }).status;
    if (status === "submitted" || status === "graded" || status === "invalidated") {
      throw new Error("Esta prova já foi finalizada");
    }

    // Upsert em exam_answers
    if (answers.length) {
      const rows = answers.map((a) => {
        const isBlank = a.selectedOptionId == null || a.selectedOptionId === "";
        return {
          session_id: sessionId,
          question_id: a.questionId,
          answer: a.selectedOptionId ? JSON.stringify({ selected: a.selectedOptionId }) : null,
          is_blank: isBlank,
          flagged: a.flagged ?? false,
          answered_at: isBlank ? null : new Date().toISOString(),
        };
      });
      const { error: upErr } = await supabaseAdmin
        .from("exam_answers")
        .upsert(rows, { onConflict: "session_id,question_id" });
      if (upErr) throw new Error(upErr.message);
    }

    // Fecha a sessão. A nota fica null — só o professor libera.
    const now = new Date().toISOString();
    const { data: closed, error: cErr } = await supabaseAdmin
      .from("exam_sessions")
      .update({
        status: "submitted",
        submitted_at: now,
        last_activity_at: now,
      })
      .eq("id", sessionId)
      .select("id, status, submitted_at")
      .single();
    if (cErr) throw new Error(cErr.message);

    return closed;
  });

/* ============================================================================
 * INSPECAO LEVE + GATE DE PRESENCA
 *
 * Usado pela rota /aluno/avaliacao/$examId ANTES de criar exam_session.
 * Devolve:
 *  - dados minimos para renderizar a sala / o gate;
 *  - a aula do Diario Digital (attendance_sessions) que libera a prova
 *    (caso exista), ou null se a presenca ainda nao foi confirmada.
 *
 * Regras:
 *  - Sessao ja submetida/graded/invalidated: libera a sala direto, sem
 *    exigir nova presenca (a checagem original ja foi feita quando o
 *    aluno entrou pela primeira vez).
 *  - Caso contrario, exige presenca confirmada em uma aula cuja
 *    `starts_at` cai dentro da janela `opens_at..closes_at` da prova.
 * ========================================================================== */
export const getOnlineExamAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ examId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const exam = await assertStudentOwnsExam(data.examId, userId);

    const now = new Date();
    const win = computeInWindow(exam.opens_at, exam.closes_at, exam.status, now);

    // Permite carregar prova ja submetida (visualizacao) mesmo fora dela.
    const existing = await getActiveOrSubmittedSession(exam.id, userId);
    const closedForStudent =
      existing &&
      (existing.status === "submitted" ||
        existing.status === "graded" ||
        existing.status === "invalidated");

    if (!win.inWindow && !closedForStudent) {
      throw new Error(win.label ?? "A prova nao esta disponivel no momento");
    }

    let attendanceSession: AttendanceSessionRef | null = null;
    if (closedForStudent) {
      attendanceSession = null;
    } else {
      attendanceSession = await findAttendanceRecordForExam(
        exam.id,
        exam.discipline_id,
        userId,
        exam.opens_at,
        exam.closes_at,
        now,
      );
    }

    return {
      exam_id: exam.id,
      title: exam.title,
      has_attendance: !!attendanceSession,
      attendance_session: attendanceSession,
      session_status: existing?.status ?? null,
    } as {
      exam_id: string;
      title: string;
      has_attendance: boolean;
      attendance_session: AttendanceSessionRef | null;
      session_status: string | null;
    };
  });
