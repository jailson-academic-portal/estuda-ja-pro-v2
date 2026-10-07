/**
 * Tipos PROVISÓRIOS das tabelas de avaliação online.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * `src/integrations/supabase/types.ts` é gerado a partir do banco real, e as
 * tabelas `user_biometrics`, `online_exams`, `exam_sessions` e `exam_answers`
 * ainda não foram incluídas nele (a regeneração depende de SUPABASE_ACCESS_TOKEN).
 *
 * NOTA ATUAL
 * As 4 tabelas JÁ FORAM inseridas em `src/integrations/supabase/types.ts`
 * (entre os marcadores "blocos manuais"). Este arquivo guarda apenas os tipos
 * nominalmente uteis no app. Quando o types.ts for regenerado do banco, os
 * blocos manuais somem e este arquivo pode ser removido.
 *
 * LIBERACAO: a sala de prova exige que o aluno tenha PRESENCA confirmada
 * no Diario Digital (attendance_records.status='present') em uma aula
 * (attendance_session) da mesma disciplina dentro do periodo da prova.
 * A biometria e o PIN foram descartados.
 *
 * As permissões de escrita ficam em `src/backend/online-exams.functions.ts`,
 * que usa `supabaseAdmin` + `assertTeacherOrAdmin` — o mesmo padrão de
 * `src/backend/grader.functions.ts`.
 */

import type { Json } from "./types";

export type BiometricKind = "face" | "fingerprint" | "iris" | "voice";
export type OnlineExamStatus = "draft" | "scheduled" | "open" | "closed" | "archived";
export type ExamSessionStatus =
  "not_started" | "in_progress" | "submitted" | "graded" | "invalidated";

export interface OnlineExamRow {
  id: string;
  assessment_id: string;
  discipline_id: string;
  created_by: string;
  title: string;
  instructions: string | null;
  status: OnlineExamStatus;
  time_limit_minutes: number;
  max_score: string;
  randomize_questions: boolean;
  randomize_options: boolean;
  opens_at: string | null;
  closes_at: string | null;
  /**
   * Colunas herdadas da era biométrica. A feature de biometria está
   * em pausa e a UI não oferece mais o toggle, mas as colunas
   * continuam existindo no banco (sempre gravadas como false/null)
   * para evitar migração destrutiva. Podem ser removidas em uma
   * migration futura sem impacto no fluxo atual.
   */
  biometric_required: boolean;
  biometric_kind_required: BiometricKind | null;
  require_face_match: boolean;
  max_attempts: number;
  proctoring_enabled: boolean;
  tab_switch_limit: number | null;
  allow_resume: boolean;
  config: Json;
  created_at: string;
  updated_at: string;
}

/** Campos que o professor pode gravar. `created_by` e `discipline_id` vêm do servidor. */
export interface OnlineExamInsert {
  assessment_id: string;
  discipline_id: string;
  created_by: string;
  title: string;
  instructions?: string | null;
  status?: OnlineExamStatus;
  time_limit_minutes?: number;
  max_score?: string;
  randomize_questions?: boolean;
  randomize_options?: boolean;
  opens_at?: string | null;
  closes_at?: string | null;
  biometric_required?: boolean;
  biometric_kind_required?: BiometricKind | null;
  require_face_match?: boolean;
  max_attempts?: number;
  proctoring_enabled?: boolean;
  tab_switch_limit?: number | null;
  allow_resume?: boolean;
  config?: Json;
}

export type OnlineExamUpdate = Partial<Omit<OnlineExamInsert, "discipline_id" | "created_by">>;

export interface ExamSessionRow {
  id: string;
  exam_id: string;
  student_id: string;
  attempt_number: number;
  status: ExamSessionStatus;
  access_token: string;
  started_at: string | null;
  last_activity_at: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  expires_at: string | null;
  /**
   * Telemetria de integridade. Não há mais colunas biométricas
   * (a biometria foi descartada; a liberação usa o Diário Digital).
   */
  identity_snapshot: Json;
  tab_switches: number;
  fullscreen_exits: number;
  focus_lost_count: number;
  integrity_flags: Json;
  score: string | null;
  final_feedback: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamAnswerRow {
  id: string;
  session_id: string;
  question_id: string;
  answer: Json | null;
  is_blank: boolean;
  flagged: boolean;
  points_awarded: string | null;
  max_points: string | null;
  is_correct: boolean | null;
  auto_score: string | null;
  manual_score: string | null;
  grader_comment: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------------------------------------------------------------------------
 * Tipos públicos usados pelas rotas do aluno.
 *
 *  - OnlineExamForStudentListItem: o que o dashboard do aluno lista para
 *    decidir se mostra o botão "Iniciar Avaliação". NÃO inclui gabarito.
 *  - OnlineExamForStudentSession: o payload completo que a rota dinâmica
 *    passa para <StudentOnlineExamRoom>. Traz as questões (prompt + options)
 *    e nada de correct_answer / rubric / explanation.
 * ------------------------------------------------------------------------- */

/**
 * Sessão do Diário Digital que libera a prova online.
 * Retornada pelo `getOnlineExamAccess` para que a UI mostre ao aluno qual
 * aula/turno liberou a prova (ou indique que a presença ainda não foi
 * confirmada).
 */
export interface AttendanceSessionRef {
  id: string;
  topic: string | null;
  session_date: string;
  starts_at: string;
}

export interface OnlineExamForStudentListItem {
  id: string;
  title: string;
  discipline_id: string;
  discipline_name: string | null;
  status: OnlineExamStatus;
  opens_at: string | null;
  closes_at: string | null;
  time_limit_minutes: number;
  max_score: string;
  question_count: number;
  /** Sessão ativa (not_started/in_progress) ou já submetida pelo aluno. */
  session_status: ExamSessionStatus | null;
  /** Janela aberta para o aluno neste instante (computed no servidor). */
  in_window: boolean;
  /** Texto humano explicando por que o botão está/ficará disponível. */
  availability_label: string | null;
  /**
   * Se true, o aluno tem presença confirmada em uma aula (attendance_session)
   * da mesma disciplina dentro do período da prova. Quando false, a sala
   * fica travada até que a presença seja marcada pelo Diário Digital.
   * Já é `true` automaticamente para provas já submetidas/graded.
   */
  has_attendance: boolean;
}

export interface OnlineExamQuestionForStudent {
  id: string;
  position: number;
  qtype: string;
  prompt: string;
  /** Opções sem o gabarito: cada item tem só id + label. */
  options: Array<{ id: string; label: string }>;
  weight: string;
}

export interface OnlineExamSessionForStudent {
  session_id: string;
  exam_id: string;
  status: ExamSessionStatus;
  started_at: string | null;
  expires_at: string | null;
  /** Para carregar respostas já marcadas se allow_resume=true. */
  existing_answers: Array<{
    question_id: string;
    selected_option_id: string | null;
    flagged: boolean;
  }>;
}

export interface OnlineExamForStudentSession {
  exam: {
    id: string;
    title: string;
    instructions: string | null;
    discipline_id: string;
    discipline_name: string | null;
    time_limit_minutes: number;
    max_score: string;
    opens_at: string | null;
    closes_at: string | null;
    /**
     * Limite absoluto (UTC) para a entrega das respostas. Quando o cronômetro
     * visual zera, o cliente dispara o auto-submit. Se a janela da prova
     * (closes_at) for anterior a este valor, ela prevalece.
     */
    expires_at: string | null;
  };
  session: OnlineExamSessionForStudent;
  questions: OnlineExamQuestionForStudent[];
}

/* ---------------------------------------------------------------------------
 * Client tipado para as tabelas novas.
 *
 * O `supabaseAdmin` é tipado pelo `Database` gerado, que ainda não conhece estas
 * quatro tabelas. Em vez de editar o types.ts (que é sobrescrito a cada
 * regeneração), sobrepomos o tipo só aqui e fazemos um cast único no acesso.
 * ------------------------------------------------------------------------- */
