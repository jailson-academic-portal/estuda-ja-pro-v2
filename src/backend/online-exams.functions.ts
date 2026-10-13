import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import type { OnlineExamRow, OnlineExamStatus } from "@/integrations/supabase/online-exams.types";
import { stripBiometricFlags, forceDisabledProctoringFlags } from "./online-exams-pure";

/* ============================================================================
 * AVALIAÇÕES ONLINE — funções do professor
 *
 * Segue o padrão de `assessments.functions.ts`: server fn + supabaseAdmin +
 * assertTeacherOrAdmin antes de qualquer escrita.
 *
 * BIOMETRIA REMOVIDA (decisão de Produto): as colunas biometric_required,
 * biometric_kind_required e require_face_match em public.online_exams são
 * herdadas da era biométrica e ainda existem no schema. A decisão de
 * removê-las do banco é do DBA. Enquanto a migration de remoção não é
 * aplicada, este módulo **força** os flags para `false` / `null` antes de
 * gravar — qualquer valor enviado pelo cliente é ignorado. A função
 * `validateBiometricFlags` foi removida: nada precisa mais ser validado.
 *
 * ATENÇÃO: quando a migration de remoção rodar, este módulo deve ser
 * atualizado para tirar os campos dos Zod shapes e do payload. Até lá, o
 * payload é persistido com os 3 campos zerados.
 * ========================================================================== */

const statusEnum = z.enum(["draft", "scheduled", "open", "closed", "archived"]);
const kindEnum = z.enum(["face", "fingerprint", "iris", "voice"]);

function roundTwo(n: number) {
  return Math.round(n * 100) / 100;
}

const examShape = z.object({
  title: z.string().min(1, "Informe o título").max(200),
  instructions: z.string().max(4000).nullish(),
  status: statusEnum.default("draft"),
  time_limit_minutes: z.number().int().min(1).max(600).default(60),
  max_score: z.number().min(0).max(1000).default(10),
  randomize_questions: z.boolean().default(false),
  randomize_options: z.boolean().default(false),
  opens_at: z.string().nullish(),
  closes_at: z.string().nullish(),
  biometric_required: z.boolean().default(false),
  biometric_kind_required: kindEnum.nullish(),
  require_face_match: z.boolean().default(false),
  max_attempts: z.number().int().min(1).max(20).default(1),
  proctoring_enabled: z.boolean().default(false),
  tab_switch_limit: z.number().int().min(0).max(999).nullish(),
  allow_resume: z.boolean().default(true),
});

/** Regras que o CHECK do banco também impõe — validadas aqui para erro legível. */
function validateWindow(opens_at: string | null | undefined, closes_at: string | null | undefined) {
  if (opens_at && closes_at && new Date(closes_at) <= new Date(opens_at)) {
    throw new Error("A data de encerramento deve ser posterior à de abertura");
  }
}

// `stripBiometricFlags` e `forceDisabledProctoringFlags` foram extraídos
// para `./online-exams-pure.ts` para serem testáveis sem Supabase.

// ---------- LISTAR ----------------------------------------------------------
export const listOnlineExams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ disciplineId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: rows, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select(
        "id, assessment_id, discipline_id, created_by, title, instructions, status, time_limit_minutes, max_score, opens_at, closes_at, biometric_required, biometric_kind_required, require_face_match, max_attempts, proctoring_enabled, tab_switch_limit, allow_resume, created_at, updated_at",
      )
      .eq("discipline_id", data.disciplineId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Contagem de sessões por prova, para o professor ver o engagement.
    const examIds = (rows ?? []).map((r) => r.id as string);
    const counts = new Map<string, { total: number; submitted: number }>();
    if (examIds.length) {
      const { data: sessions, error: sErr } = await (
        await supabaseAdmin
      )
        .from("exam_sessions")
        .select("exam_id, status")
        .in("exam_id", examIds);
      if (sErr) throw new Error(sErr.message);
      for (const s of sessions ?? []) {
        const bucket = counts.get(s.exam_id as string) ?? { total: 0, submitted: 0 };
        bucket.total += 1;
        if (s.status === "submitted" || s.status === "graded") bucket.submitted += 1;
        counts.set(s.exam_id as string, bucket);
      }
    }

    // Rótulo da assessment de origem (evita N+1 na UI).
    const assessmentIds = [...new Set((rows ?? []).map((r) => r.assessment_id as string))];
    const titles = new Map<string, string>();
    if (assessmentIds.length) {
      const { data: asms, error: aErr } = await (
        await supabaseAdmin
      )
        .from("assessments")
        .select("id, title")
        .in("id", assessmentIds);
      if (aErr) throw new Error(aErr.message);
      for (const a of asms ?? []) titles.set(a.id as string, a.title as string);
    }

    return (rows ?? []).map((r) => ({
      ...(r as unknown as OnlineExamRow),
      assessment_title: titles.get(r.assessment_id as string) ?? "—",
      session_total: counts.get(r.id as string)?.total ?? 0,
      session_submitted: counts.get(r.id as string)?.submitted ?? 0,
    }));
  });

// ---------- LISTAR ASSESSMENTS CANDATAS ------------------------------------
// Só retorna assessments da disciplina, para o professor escolher a fonte das
// questões. `options` e `correct_answer` NÃO são selecionadas: o gabarito não
// deve trafegar para o cliente do professor durante o cadastro.
export const listAssessmentsForOnlineExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ disciplineId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: asms, error } = await (
      await supabaseAdmin
    )
      .from("assessments")
      .select("id, title, status, max_score, created_at")
      .eq("discipline_id", data.disciplineId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const ids = (asms ?? []).map((a) => a.id as string);
    const questionCount = new Map<string, number>();
    if (ids.length) {
      // Só assessment_id: o gabarito não trafega para o cliente.
      const { data: qs, error: qErr } = await (
        await supabaseAdmin
      )
        .from("assessment_questions")
        .select("assessment_id")
        .in("assessment_id", ids);
      if (qErr) throw new Error(qErr.message);
      for (const q of qs ?? []) {
        const k = q.assessment_id as string;
        questionCount.set(k, (questionCount.get(k) ?? 0) + 1);
      }
    }

    return (asms ?? []).map((a) => ({
      id: a.id as string,
      title: a.title as string,
      status: a.status as string,
      max_score: a.max_score,
      created_at: a.created_at as string,
      question_count: questionCount.get(a.id as string) ?? 0,
    }));
  });

// ---------- CRIAR -----------------------------------------------------------
export const createOnlineExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        disciplineId: z.string().uuid(),
        assessmentId: z.string().uuid(),
        ...examShape.shape,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);
    validateWindow(data.opens_at, data.closes_at);

    // A assessment precisa pertencer à mesma disciplina — evita atravessar
    // a fronteira entre disciplinas com um id válido de outra.
    const { data: asms, error: aErr } = await (
      await supabaseAdmin
    )
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", data.assessmentId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!asms) throw new Error("Avaliação de origem não encontrada");
    if (asms.discipline_id !== data.disciplineId) {
      throw new Error("A avaliação de origem pertence a outra disciplina");
    }

    const payload = stripBiometricFlags({
      assessment_id: data.assessmentId,
      discipline_id: data.disciplineId,
      created_by: context.userId,
      title: data.title,
      instructions: data.instructions ?? null,
      status: data.status,
      time_limit_minutes: data.time_limit_minutes,
      max_score: roundTwo(data.max_score),
      randomize_questions: data.randomize_questions,
      randomize_options: data.randomize_options,
      opens_at: data.opens_at ?? null,
      closes_at: data.closes_at ?? null,
      max_attempts: data.max_attempts,
      proctoring_enabled: data.proctoring_enabled,
      tab_switch_limit: data.tab_switch_limit ?? null,
      allow_resume: data.allow_resume,
    });

    const { data: created, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .insert(payload)
      .select("id, title, status")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

// ---------- ATUALIZAR -------------------------------------------------------
export const updateOnlineExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid(), ...examShape.shape }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: exam, error: eErr } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select("discipline_id")
      .eq("id", data.id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!exam) throw new Error("Prova online não encontrada");

    await assertTeacherOrAdmin(exam.discipline_id as string, context.userId);
    validateWindow(data.opens_at, data.closes_at);

    const { data: updated, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .update(
        stripBiometricFlags({
          title: data.title,
          instructions: data.instructions ?? null,
          status: data.status,
          time_limit_minutes: data.time_limit_minutes,
          max_score: roundTwo(data.max_score),
          randomize_questions: data.randomize_questions,
          randomize_options: data.randomize_options,
          opens_at: data.opens_at ?? null,
          closes_at: data.closes_at ?? null,
          max_attempts: data.max_attempts,
          proctoring_enabled: data.proctoring_enabled,
          tab_switch_limit: data.tab_switch_limit ?? null,
          allow_resume: data.allow_resume,
        }),
      )
      .eq("id", data.id)
      .select("id, title, status")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

// ---------- MUDAR STATUS ----------------------------------------------------
export const setOnlineExamStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid(), status: statusEnum }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: exam, error: eErr } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select("discipline_id")
      .eq("id", data.id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!exam) throw new Error("Prova online não encontrada");

    await assertTeacherOrAdmin(exam.discipline_id as string, context.userId);

    const { data: updated, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .update({ status: data.status })
      .eq("id", data.id)
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

// ---------- EXCLUIR ---------------------------------------------------------
export const deleteOnlineExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: exam, error: eErr } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select("discipline_id")
      .eq("id", data.id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!exam) throw new Error("Prova online não encontrada");

    await assertTeacherOrAdmin(exam.discipline_id as string, context.userId);

    // ON DELETE CASCADE leva junto sessions e answers — é o comportamento
    // desejado, mas avisamos no toast da UI para o professor não perder
    // trabalho de aluno por engano.
    const { count: sessionCount } = await (
      await supabaseAdmin
    )
      .from("exam_sessions")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", data.id);

    const { error } = await (await supabaseAdmin).from("online_exams").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    return { deleted: true, sessions_removed: sessionCount ?? 0 };
  });

/* ============================================================================
 * CONFIGURACAO DE PROVA ONLINE a partir de uma avaliacao existente
 *
 * Usado pelo botao "Configurar Prova Online" na lista de avaliacoes.
 * Faz UPSERT por assessment_id: uma avaliacao tem no maximo uma prova online.
 *
 * LIBERACAO: a sala de prova NAO exige mais PIN nem biometria. A
 * regra e a seguinte: o professor vincula a prova a UMA chamada
 * especifica do Diario Digital (attendance_sessions). O aluno
 * registra presenca NESTA chamada (via QR Code ou codigo de 6
 * letras, pelo proprio sistema), e a sala e destravada
 * automaticamente. Sem vinculo, a prova fica bloqueada (fallback
 * para busca por janela temporal existe apenas para provas
 * legadas). Ver `getOnlineExamAccess` em
 * online-exams.student.functions.ts.
 * ========================================================================== */

const configShape = z.object({
  assessmentId: z.string().uuid(),
  disciplineId: z.string().uuid(),
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).nullish(),
  opensAt: z.string().nullish(),
  closesAt: z.string().nullish(),
  timeLimitMinutes: z.number().int().min(1).max(600).default(60),
  maxScore: z.number().min(0).max(1000).default(10),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  /**
   * ID da chamada do Diario Digital (attendance_sessions) que
   * libera esta prova. Quando definido, a presenca NESTA chamada
   * e o que destrava a sala para o aluno (via QR Code ou codigo
   * de 6 letras). Quando null, o sistema usa o fallback de
   * "qualquer chamada da disciplina dentro da janela da prova".
   */
  attendanceSessionId: z.string().uuid().nullish(),
  biometricRequired: z.boolean().default(false),
  biometricKind: kindEnum.nullish(),
  requireFaceMatch: z.boolean().default(false),
  tabSwitchLimit: z.number().int().min(0).max(999).nullish(),
});

/**
 * Decide o status inicial: se a janela ja esta aberta agora, libera como
 * 'open' (corrige o bug "provas novas nao aparecem"). Caso contrario,
 * mantem 'draft' para o professor publicar manualmente.
 */
function decideInitialStatus(opensAt: string | null, closesAt: string | null): "open" | "draft" {
  const now = Date.now();
  const opensOk = !opensAt || new Date(opensAt).getTime() <= now;
  const closesOk = !closesAt || new Date(closesAt).getTime() > now;
  return opensOk && closesOk ? "open" : "draft";
}

export const saveOnlineExamConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => configShape.parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    if (data.opensAt && data.closesAt && new Date(data.closesAt) <= new Date(data.opensAt)) {
      throw new Error("O encerramento deve ser posterior a abertura");
    }

    const { data: asms, error: aErr } = await (
      await supabaseAdmin
    )
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", data.assessmentId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!asms) throw new Error("Avaliacao nao encontrada");
    if (asms.discipline_id !== data.disciplineId) {
      throw new Error("A avaliacao pertence a outra disciplina");
    }

    // Se o professor passou um ID de chamada, confere que ela existe
    // e pertence a mesma disciplina. Sem isso, um professor poderia
    // vincular a chamada de outra disciplina e liberar alunos
    // errados.
    if (data.attendanceSessionId) {
      const { data: att, error: aErr2 } = await supabaseAdmin
        .from("attendance_sessions")
        .select("id, discipline_id")
        .eq("id", data.attendanceSessionId)
        .maybeSingle();
      if (aErr2) throw new Error(aErr2.message);
      if (!att) throw new Error("Chamada do Diario Digital nao encontrada");
      if (att.discipline_id !== data.disciplineId) {
        throw new Error("A chamada do Diario Digital pertence a outra disciplina");
      }
    }

    // Descobre o status atual para respeitar transicoes manuais.
    const { data: existing, error: eErr } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select("status")
      .eq("assessment_id", data.assessmentId)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    const previousStatus = (existing?.status as string | null | undefined) ?? null;

    // Status: se ja era 'closed'/'archived'/'open' antes, respeitamos;
    // senao, decidimos entre 'open' (janela aberta) e 'draft'.
    const isLockedStatus =
      previousStatus === "closed" || previousStatus === "archived" || previousStatus === "open";
    const status: "open" | "draft" = isLockedStatus
      ? ((previousStatus as "open" | "draft") ?? "draft")
      : decideInitialStatus(data.opensAt ?? null, data.closesAt ?? null);

    const payload = forceDisabledProctoringFlags(
      stripBiometricFlags({
        assessment_id: data.assessmentId,
        discipline_id: data.disciplineId,
        created_by: context.userId,
        title: data.title.trim(),
        instructions: data.instructions ?? null,
        opens_at: data.opensAt ?? null,
        closes_at: data.closesAt ?? null,
        time_limit_minutes: data.timeLimitMinutes,
        max_score: roundTwo(data.maxScore),
        max_attempts: data.maxAttempts,
        attendance_session_id: data.attendanceSessionId ?? null,
        status,
      }),
    );

    // Upsert direto na tabela, em cima do UNIQUE INDEX
    // idx_online_exams_assessment (assessment_id). A RPC
    // upsert_online_exam_config foi removida porque sofria do
    // cache de schema do PostgREST mesmo apos reload manual
    // ("Could not find the function ... in the schema cache").
    // Aqui o caminho e INSERT ... ON CONFLIT (assessment_id) DO
    // UPDATE, identico ao que a RPC fazia, mas sem assinatura
    // RPC para o PostgREST validar.
    const { data: saved, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .upsert(payload, { onConflict: "assessment_id" })
      .select("id, title, status")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

/** Le a config existente de uma avaliacao, se houver. */
export const getOnlineExamConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ assessmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: row, error } = await (
      await supabaseAdmin
    )
      .from("online_exams")
      .select(
        "id, title, opens_at, closes_at, time_limit_minutes, max_score, max_attempts, attendance_session_id, biometric_required, biometric_kind_required, require_face_match, tab_switch_limit",
      )
      .eq("assessment_id", data.assessmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });

/**
 * Lista as chamadas do Diario Digital (attendance_sessions) da
 * disciplina, para que o professor escolha qual vincular a prova.
 * Retorna as 30 mais recentes (filtradas para a janela da prova
 * se a prova tem opens_at/closes_at; caso contrario, qualquer
 * uma recente). Apenas autenticados que tem permissao na
 * disciplina (assertTeacherOrAdmin).
 */
export const listAttendanceSessionsForExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        disciplineId: z.string().uuid(),
        opensAt: z.string().nullish(),
        closesAt: z.string().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    // Janela: a prova abre nesse intervalo. Sem janela, aceitamos
    // chamadas dos ultimos 60 dias.
    const now = Date.now();
    const floor = data.opensAt ? new Date(data.opensAt).getTime() : now - 60 * 24 * 60 * 60 * 1000;
    const ceiling = data.closesAt
      ? new Date(data.closesAt).getTime()
      : now + 60 * 24 * 60 * 60 * 1000;

    const { data: rows, error } = await supabaseAdmin
      .from("attendance_sessions")
      .select(
        "id, topic, session_date, starts_at, code, closed_at, code_window_minutes, created_at",
      )
      .eq("discipline_id", data.disciplineId)
      .gte("starts_at", new Date(floor).toISOString())
      .lte("starts_at", new Date(ceiling).toISOString())
      .order("starts_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export type OnlineExamListItem = OnlineExamRow & {
  assessment_title: string;
  session_total: number;
  session_submitted: number;
};
