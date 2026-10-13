// Testes de regra de negócio das submissões de alunos (atividades e
// trabalhos acadêmicos). Roda com `node --test` puro, sem dependências
// adicionais. Compila o módulo `submissions-pure.ts` para `.test-build/`
// e executa os asserts.
//
// Cobertura:
//   1. Usuário não autenticado é rejeitado.
//   2. Usuário sem matrícula na disciplina é rejeitado.
//   3. Usuário autenticado e matriculado consegue submeter.
//   4. `student_id` gravado é sempre o ID do usuário autenticado,
//      nunca um valor enviado pelo cliente (mesmo se payload trouxer
//      `student_id` malicioso).
//   5. Falha de notificação NÃO aborta a submissão.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  submitActivityPure,
  submitAcademicWorkPure,
  type ActivityDeps,
  type WorkDeps,
} from "./submissions-pure.js";

const ALICE = "00000000-0000-0000-0000-0000000000a1";
const BOB = "00000000-0000-0000-0000-0000000000b2";
const MALLORY = "00000000-0000-0000-0000-0000000000d4";
const DISC_X = "00000000-0000-0000-0000-0000000000c1";
const DISC_Y = "00000000-0000-0000-0000-0000000000c2";
const ACT_ID = "00000000-0000-0000-0000-0000000000e1";
const WORK_ID = "00000000-0000-0000-0000-0000000000e2";

function makeActivityDeps(overrides: Partial<ActivityDeps> = {}): {
  deps: ActivityDeps;
  calls: { upsert: unknown[]; notify: unknown[] };
} {
  const calls: { upsert: unknown[]; notify: unknown[] } = { upsert: [], notify: [] };
  const deps: ActivityDeps = {
    lookupActivity: async (id) =>
      id === ACT_ID ? { id: ACT_ID, discipline_id: DISC_X, title: "Atividade 1" } : null,
    lookupEnrollment: async (disciplineId, studentId) =>
      disciplineId === DISC_X && studentId === ALICE,
    upsertActivitySubmission: async (row) => {
      calls.upsert.push(row);
    },
    notifyTeacher: async (p) => {
      calls.notify.push(p);
    },
    ...overrides,
  };
  return { deps, calls };
}

function makeWorkDeps(overrides: Partial<WorkDeps> = {}): {
  deps: WorkDeps;
  calls: { upsert: unknown[]; notify: unknown[] };
} {
  const calls: { upsert: unknown[]; notify: unknown[] } = { upsert: [], notify: [] };
  const deps: WorkDeps = {
    lookupWork: async (id) =>
      id === WORK_ID ? { id: WORK_ID, discipline_id: DISC_X, title: "Trabalho 1" } : null,
    lookupEnrollment: async (disciplineId, studentId) =>
      disciplineId === DISC_X && studentId === ALICE,
    upsertWorkSubmission: async (row) => {
      calls.upsert.push(row);
    },
    notifyTeacher: async (p) => {
      calls.notify.push(p);
    },
    ...overrides,
  };
  return { deps, calls };
}

// ============== submitActivityPure ==============

test("submitActivity: rejeita caller ausente", async () => {
  const { deps, calls } = makeActivityDeps();
  await assert.rejects(
    () => submitActivityPure("", { activity_id: ACT_ID }, deps),
    /Usuário não autenticado/,
  );
  assert.equal(calls.upsert.length, 0, "não deve gravar");
  assert.equal(calls.notify.length, 0, "não deve notificar");
});

test("submitActivity: rejeita atividade inexistente", async () => {
  const { deps, calls } = makeActivityDeps();
  await assert.rejects(
    () => submitActivityPure(ALICE, { activity_id: "outro-id" }, deps),
    /Atividade não encontrada/,
  );
  assert.equal(calls.upsert.length, 0);
});

test("submitActivity: rejeita caller não matriculado", async () => {
  const { deps, calls } = makeActivityDeps();
  await assert.rejects(
    () => submitActivityPure(BOB, { activity_id: ACT_ID }, deps),
    /Você não está matriculado nesta disciplina/,
  );
  assert.equal(calls.upsert.length, 0, "não deve gravar sem matrícula");
  assert.equal(calls.notify.length, 0, "não deve notificar sem matrícula");
});

test("submitActivity: caller matriculado grava com seu próprio student_id", async () => {
  const { deps, calls } = makeActivityDeps();
  const result = await submitActivityPure(
    ALICE,
    { activity_id: ACT_ID, answers: { q1: "ok" }, questions: ["q1"] },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.discipline_id, DISC_X);
  assert.equal(result.student_id, ALICE);
  assert.equal(calls.upsert.length, 1);
  const upsert = calls.upsert[0] as { activity_id: string; student_id: string; status: string };
  assert.equal(upsert.activity_id, ACT_ID);
  assert.equal(upsert.student_id, ALICE, "student_id deve ser o do caller");
  assert.equal(upsert.status, "submitted");
  assert.equal(calls.notify.length, 1);
  const notify = calls.notify[0] as { kind: string; studentId: string };
  assert.equal(notify.kind, "activity");
  assert.equal(notify.studentId, ALICE);
});

test("submitActivity: ignora student_id enviado pelo payload", async () => {
  // Defesa contra IDOR: o payload pode ter student_id "MALLORY", mas
  // o que vai pro banco é sempre o callerUserId (ALICE).
  const { deps, calls } = makeActivityDeps();
  // O tipo SubmitActivityInput não tem student_id por design; este cast
  // simula um payload adulterado em runtime.
  const maliciousPayload = {
    activity_id: ACT_ID,
    student_id: MALLORY,
    answers: {},
    questions: [],
  };
  const result = await submitActivityPure(ALICE, maliciousPayload, deps);
  assert.equal(result.student_id, ALICE);
  const upsert = calls.upsert[0] as { student_id: string };
  assert.equal(upsert.student_id, ALICE, "payload.student_id é ignorado");
  assert.notEqual(upsert.student_id, MALLORY);
});

test("submitActivity: falha de notify NÃO aborta a submissão", async () => {
  const { deps, calls } = makeActivityDeps({
    notifyTeacher: async () => {
      throw new Error("SMTP fora do ar");
    },
  });
  // Não deve lançar.
  const result = await submitActivityPure(ALICE, { activity_id: ACT_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(calls.upsert.length, 1, "submissão gravada apesar do notify falhar");
});

// ============== submitAcademicWorkPure ==============

test("submitWork: rejeita caller ausente", async () => {
  const { deps, calls } = makeWorkDeps();
  await assert.rejects(
    () => submitAcademicWorkPure("", { work_id: WORK_ID, file_url: "u" }, deps),
    /Usuário não autenticado/,
  );
  assert.equal(calls.upsert.length, 0);
});

test("submitWork: rejeita trabalho inexistente", async () => {
  const { deps, calls } = makeWorkDeps();
  await assert.rejects(
    () => submitAcademicWorkPure(ALICE, { work_id: "outro", file_url: "u" }, deps),
    /Trabalho não encontrado/,
  );
  assert.equal(calls.upsert.length, 0);
});

test("submitWork: rejeita caller não matriculado", async () => {
  const { deps, calls } = makeWorkDeps();
  await assert.rejects(
    () => submitAcademicWorkPure(BOB, { work_id: WORK_ID, file_url: "u" }, deps),
    /Você não está matriculado nesta disciplina/,
  );
  assert.equal(calls.upsert.length, 0);
});

test("submitWork: caller matriculado grava com seu próprio student_id", async () => {
  const { deps, calls } = makeWorkDeps();
  const result = await submitAcademicWorkPure(
    ALICE,
    { work_id: WORK_ID, file_url: "u", submission_text: "ok" },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.student_id, ALICE);
  const upsert = calls.upsert[0] as {
    work_id: string;
    student_id: string;
    submission_text: string;
    status: string;
  };
  assert.equal(upsert.work_id, WORK_ID);
  assert.equal(upsert.student_id, ALICE);
  assert.equal(upsert.submission_text, "ok");
  assert.equal(upsert.status, "submitted");
  assert.equal(calls.notify.length, 1);
  const notify = calls.notify[0] as { kind: string };
  assert.equal(notify.kind, "work");
});

test("submitWork: ignora student_id enviado pelo payload (IDOR)", async () => {
  const { deps, calls } = makeWorkDeps();
  const maliciousPayload = {
    work_id: WORK_ID,
    file_url: "u",
    student_id: MALLORY,
  };
  const result = await submitAcademicWorkPure(ALICE, maliciousPayload, deps);
  assert.equal(result.student_id, ALICE);
  const upsert = calls.upsert[0] as { student_id: string };
  assert.equal(upsert.student_id, ALICE);
  assert.notEqual(upsert.student_id, MALLORY);
});

test("submitWork: falha de notify NÃO aborta a submissão", async () => {
  const { deps, calls } = makeWorkDeps({
    notifyTeacher: async () => {
      throw new Error("queue offline");
    },
  });
  const result = await submitAcademicWorkPure(
    ALICE,
    { work_id: WORK_ID, file_url: "u" },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(calls.upsert.length, 1);
});

// ============== Isolamento entre disciplinas ==============

test("submitActivity: caller matriculado em OUTRA disciplina é rejeitado", async () => {
  const { deps, calls } = makeActivityDeps({
    lookupEnrollment: async (disciplineId, studentId) =>
      disciplineId === DISC_Y && studentId === ALICE, // só em DISC_Y
  });
  // A atividade pertence a DISC_X; ALICE está só em DISC_Y.
  await assert.rejects(
    () => submitActivityPure(ALICE, { activity_id: ACT_ID }, deps),
    /Você não está matriculado nesta disciplina/,
  );
  assert.equal(calls.upsert.length, 0);
});
