import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
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
    .select("id, discipline_id, status, opens_at, closes_at, time_limit_minutes, allow_resume")
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

/* ============================================================================
 * LISTAR — avaliações disponíveis para o aluno
 *
 * Critérios:
 *  - status = 'open'
 *  - aluno matriculado na disciplina
 *  - dentro da janela opens_at..closes_at (status dinâmico)
 * Retorna também sessões existentes (para diferenciar "Iniciar" vs "Retomar").
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
        "id, title, discipline_id, status, opens_at, closes_at, time_limit_minutes, max_score, assessment_id",
      )
      .in("discipline_id", disciplineIds)
      .eq("status", "open")
      .order("closes_at", { ascending: true, nullsFirst: false });
    if (exErr) throw new Error(exErr.message);
    if (!exams || exams.length === 0) return [];

    // 3) Contagem de questões por prova
    const assessmentIds = [
      ...new Set(
        exams.map((e: { assessment_id: string }) => e.assessment_id).filter(isUuid),
      ),
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

    const now = new Date();
    const out: OnlineExamForStudentListItem[] = (exams as unknown as Array<{
      id: string;
      title: string;
      discipline_id: string;
      status: string;
      opens_at: string | null;
      closes_at: string | null;
      time_limit_minutes: number;
      max_score: string;
      assessment_id: string;
    }>).map((e) => {
      const win = computeInWindow(e.opens_at, e.closes_at, e.status, now);
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
        session_status: sessionByExam.get(e.id) ?? null,
        in_window: win.inWindow,
        availability_label: win.label,
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
      .select("id, title, instructions, assessment_id, discipline_id, time_limit_minutes, max_score, opens_at, closes_at, allow_resume")
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
      const expiresAt = new Date(
        now.getTime() + exam.time_limit_minutes * 60 * 1000,
      ).toISOString();
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
      const expiresAt = new Date(
        now.getTime() + exam.time_limit_minutes * 60 * 1000,
      ).toISOString();
      const { data: updated, error: uErr } = await supabaseAdmin
        .from("exam_sessions")
        .update({ status: "in_progress", started_at: startedAt, last_activity_at: startedAt, expires_at: expiresAt })
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
      existingAnswers = (ans ?? []).map((r: {
        question_id: string;
        answer: unknown;
        flagged: boolean;
      }) => ({
        question_id: r.question_id,
        selected_option_id: extractSelectedOptionId(r.answer),
        flagged: !!r.flagged,
      }));
    } else if (sessionRow.status === "submitted" || sessionRow.status === "graded") {
      const { data: ans, error: aErr } = await supabaseAdmin
        .from("exam_answers")
        .select("question_id, answer, flagged")
        .eq("session_id", sessionRow.id);
      if (aErr) throw new Error(aErr.message);
      existingAnswers = (ans ?? []).map((r: {
        question_id: string;
        answer: unknown;
        flagged: boolean;
      }) => ({
        question_id: r.question_id,
        selected_option_id: extractSelectedOptionId(r.answer),
        flagged: !!r.flagged,
      }));
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
          answer: a.selectedOptionId
            ? JSON.stringify({ selected: a.selectedOptionId })
            : null,
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