// Lógica pura das submissões de alunos (atividades e trabalhos acadêmicos).
// Extraída de `activities.functions.ts` e `works.functions.ts` para ser
// testável sem Supabase, sem `createServerFn` e sem middlewares do
// TanStack Start. Os handlers server-fn chamam estas funções passando
// as dependências injetadas (lookups/upserts/notificações).
//
// Regra de negócio coberta:
//   1. O parent (atividade ou trabalho) precisa existir; se não, erro.
//   2. O caller precisa estar matriculado na disciplina do parent;
//      se não, erro "Você não está matriculado nesta disciplina".
//   3. O `student_id` gravado é SEMPRE o `callerUserId` — qualquer
//      `studentId` enviado pelo cliente em `payload` é ignorado.
//   4. O upsert usa a chave de conflito adequada por fluxo.

export type CallerUserId = string;
export type ParentDisciplineId = string;
export type ParentId = string;

export type ActivityDeps = {
  /** Procura a atividade por id. Retorna `null` se não existir. */
  lookupActivity: (id: ParentId) => Promise<{
    id: ParentId;
    discipline_id: ParentDisciplineId;
    title: string;
  } | null>;
  /** Confirma matrícula do caller na disciplina. */
  lookupEnrollment: (
    disciplineId: ParentDisciplineId,
    studentId: CallerUserId,
  ) => Promise<boolean>;
  /** Faz upsert de submissão de atividade. Deve gravar com
   *  `student_id = callerUserId` (a função pura já injeta). */
  upsertActivitySubmission: (row: {
    activity_id: ParentId;
    student_id: CallerUserId;
    file_url: string;
    attachments: { answers: Record<string, string>; questions: string[] };
    status: "submitted";
    submitted_at: string;
  }) => Promise<void>;
  /** Notifica o professor; falhas NÃO devem abortar a submissão. */
  notifyTeacher: (params: {
    disciplineId: ParentDisciplineId;
    studentId: CallerUserId;
    kind: "activity" | "work";
    parentTitle: string;
  }) => Promise<void>;
};

export type WorkDeps = {
  /** Procura o trabalho acadêmico por id. Retorna `null` se não existir. */
  lookupWork: (id: ParentId) => Promise<{
    id: ParentId;
    discipline_id: ParentDisciplineId;
    title: string;
  } | null>;
  /** Confirma matrícula do caller na disciplina. */
  lookupEnrollment: (
    disciplineId: ParentDisciplineId,
    studentId: CallerUserId,
  ) => Promise<boolean>;
  /** Faz upsert de submissão de trabalho acadêmico. Deve gravar com
   *  `student_id = callerUserId` (a função pura já injeta). */
  upsertWorkSubmission: (row: {
    work_id: ParentId;
    student_id: CallerUserId;
    file_url: string;
    submission_text: string | null;
    status: "submitted";
    submitted_at: string;
  }) => Promise<void>;
  /** Notifica o professor; falhas NÃO devem abortar a submissão. */
  notifyTeacher: (params: {
    disciplineId: ParentDisciplineId;
    studentId: CallerUserId;
    kind: "activity" | "work";
    parentTitle: string;
  }) => Promise<void>;
};

export type SubmitActivityInput = {
  activity_id: string;
  file_url?: string;
  answers?: Record<string, string>;
  questions?: string[];
};

export type SubmitWorkInput = {
  work_id: string;
  file_url: string;
  submission_text?: string;
};

export async function submitActivityPure(
  callerUserId: CallerUserId,
  payload: SubmitActivityInput,
  deps: ActivityDeps,
): Promise<{ ok: true; discipline_id: ParentDisciplineId; student_id: CallerUserId }> {
  if (!callerUserId) {
    throw new Error("Usuário não autenticado");
  }

  const act = await deps.lookupActivity(payload.activity_id);
  if (!act) throw new Error("Atividade não encontrada");

  const enrolled = await deps.lookupEnrollment(act.discipline_id, callerUserId);
  if (!enrolled) throw new Error("Você não está matriculado nesta disciplina");

  // Importante: o `student_id` gravado é SEMPRE o do caller, mesmo
  // se o cliente (ou um payload malicioso) trouxer `student_id` em
  // outro lugar — ele simplesmente não é lido aqui.
  await deps.upsertActivitySubmission({
    activity_id: payload.activity_id,
    student_id: callerUserId,
    file_url: payload.file_url ?? "inline_submission",
    attachments: {
      answers: payload.answers ?? {},
      questions: payload.questions ?? [],
    },
    status: "submitted",
    submitted_at: new Date().toISOString(),
  });

  try {
    await deps.notifyTeacher({
      disciplineId: act.discipline_id,
      studentId: callerUserId,
      kind: "activity",
      parentTitle: act.title,
    });
  } catch {
    // Falha de notificação NÃO deve abortar a submissão.
  }

  return { ok: true, discipline_id: act.discipline_id, student_id: callerUserId };
}

export async function submitAcademicWorkPure(
  callerUserId: CallerUserId,
  payload: SubmitWorkInput,
  deps: WorkDeps,
): Promise<{ ok: true; discipline_id: ParentDisciplineId; student_id: CallerUserId }> {
  if (!callerUserId) {
    throw new Error("Usuário não autenticado");
  }

  const work = await deps.lookupWork(payload.work_id);
  if (!work) throw new Error("Trabalho não encontrado");

  const enrolled = await deps.lookupEnrollment(work.discipline_id, callerUserId);
  if (!enrolled) throw new Error("Você não está matriculado nesta disciplina");

  await deps.upsertWorkSubmission({
    work_id: payload.work_id,
    student_id: callerUserId,
    file_url: payload.file_url,
    submission_text: payload.submission_text ?? null,
    status: "submitted",
    submitted_at: new Date().toISOString(),
  });

  try {
    await deps.notifyTeacher({
      disciplineId: work.discipline_id,
      studentId: callerUserId,
      kind: "work",
      parentTitle: work.title,
    });
  } catch {
    // Falha de notificação NÃO deve abortar a submissão.
  }

  return { ok: true, discipline_id: work.discipline_id, student_id: callerUserId };
}
