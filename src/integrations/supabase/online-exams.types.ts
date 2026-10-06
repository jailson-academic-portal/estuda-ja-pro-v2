/**
 * Tipos PROVISÓRIOS das tabelas de avaliação online com biometria.
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
 * As permissões de escrita ficam em `src/backend/online-exams.functions.ts`,
 * que usa `supabaseAdmin` + `assertTeacherOrAdmin` — o mesmo padrão de
 * `src/backend/grader.functions.ts`.
 */

import type { Json } from "./types";

export type BiometricKind = "face" | "fingerprint" | "iris" | "voice";
export type OnlineExamStatus = "draft" | "scheduled" | "open" | "closed" | "archived";
export type ExamSessionStatus =
  "not_started" | "in_progress" | "submitted" | "graded" | "invalidated";
export type BiometricVerifyResult = "pending" | "verified" | "failed" | "skipped";

export interface UserBiometricRow {
  id: string;
  user_id: string;
  kind: BiometricKind;
  provider: string;
  provider_ref: string | null;
  template_data: Json;
  template_hash: string | null;
  quality_score: string | null;
  is_primary: boolean;
  is_active: boolean;
  device_label: string | null;
  enrolled_at: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

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
  biometric_status: BiometricVerifyResult;
  biometric_match_score: string | null;
  biometric_ref: string | null;
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
 * Client tipado para as tabelas novas.
 *
 * O `supabaseAdmin` é tipado pelo `Database` gerado, que ainda não conhece estas
 * quatro tabelas. Em vez de editar o types.ts (que é sobrescrito a cada
 * regeneração), sobrepomos o tipo só aqui e fazemos um cast único no acesso.
 * ------------------------------------------------------------------------- */
