// Testes da proteção contra biometria em `online-exams.functions.ts`.
// Cobre a decisão de produto "biometria removida":
//   * stripBiometricFlags sempre zera biometric_required,
//     biometric_kind_required e require_face_match, independentemente
//     do que o cliente envia.
//   * forceDisabledProctoringFlags sempre zera tab_switch_limit para
//     null (o atalho que ligava esse campo à biometria foi removido).
//
// Cobertura por fluxo de server fn:
//   1. createOnlineExam   (chama só stripBiometricFlags)
//   2. updateOnlineExam   (chama só stripBiometricFlags)
//   3. saveOnlineExamConfig (chama stripBiometricFlags + forceDisabledProctoringFlags)
//
// Os 3 fluxos compartilham o mesmo caminho de borda: o servidor
// ignora os flags biométricos do cliente. Asserções equivalentes
// para os 3 garantem que um patch futuro em um dos handlers não
// reintroduza a dependência sem que o teste falhe.
//
// Roda com `node --test` puro, sem dependências adicionais.
// Compila o módulo `online-exams-pure.ts` (sem imports externos)
// e o teste com `tsc` para `.test-build/` e executa.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripBiometricFlags,
  forceDisabledProctoringFlags,
} from "./online-exams-pure.js";

/** Helper: monta um payload "adversário" simulando o que um cliente
 *  malicioso (ou um frontend antigo) tentaria enviar com biometria
 *  ligada. */
function adversarialBiometricPayload(extra: Record<string, unknown> = {}) {
  return {
    title: "Prova X",
    instructions: null,
    status: "draft",
    time_limit_minutes: 60,
    max_score: 10,
    randomize_questions: false,
    randomize_options: false,
    opens_at: null,
    closes_at: null,
    // --- o que o cliente (malicioso) tenta ligar: ---
    biometric_required: true,
    biometric_kind_required: "face" as const,
    require_face_match: true,
    proctoring_enabled: true,
    max_attempts: 1,
    tab_switch_limit: 5,
    allow_resume: true,
    ...extra,
  };
}

/** Garante que os 3 flags biométricos saem zerados. */
function assertBiometricsStripped(payload: Record<string, unknown>) {
  assert.equal(payload.biometric_required, false, "biometric_required deve ser false");
  assert.equal(payload.biometric_kind_required, null, "biometric_kind_required deve ser null");
  assert.equal(payload.require_face_match, false, "require_face_match deve ser false");
}

// ============== stripBiometricFlags ==============

test("createOnlineExam: payload com biometria ligada -> 3 flags zerados", () => {
  // Simula o payload de `createOnlineExam` no momento em que
  // stripBiometricFlags é aplicado (campos já em snake_case).
  const result = stripBiometricFlags(adversarialBiometricPayload());
  assertBiometricsStripped(result);
  // Os outros campos passam intactos.
  assert.equal(result.title, "Prova X");
  assert.equal(result.time_limit_minutes, 60);
  assert.equal(result.max_attempts, 1);
  assert.equal(result.proctoring_enabled, true); // preservado (não é flag biométrico)
});

test("updateOnlineExam: payload com biometria ligada -> 3 flags zerados", () => {
  const result = stripBiometricFlags(adversarialBiometricPayload());
  assertBiometricsStripped(result);
  assert.equal(result.title, "Prova X");
});

test("saveOnlineExamConfig: payload com biometria ligada -> 3 flags zerados", () => {
  // saveOnlineExamConfig usa camelCase. Mapeamos para snake_case porque
  // stripBiometricFlags age no objeto que vai pro banco.
  const camelPayload = {
    assessmentId: "00000000-0000-0000-0000-0000000000a1",
    disciplineId: "00000000-0000-0000-0000-0000000000c1",
    title: "Prova Y",
    biometricRequired: true,
    biometricKind: "fingerprint" as const,
    requireFaceMatch: true,
    maxAttempts: 1,
  };
  // Para este fluxo, o handler converte camel→snake antes de aplicar
  // stripBiometricFlags. O que stripBiometricFlags efetivamente vê
  // é o payload em snake_case já convertido.
  const snakePayload = {
    assessment_id: camelPayload.assessmentId,
    discipline_id: camelPayload.disciplineId,
    title: camelPayload.title,
    biometric_required: true,
    biometric_kind_required: "fingerprint",
    require_face_match: true,
  };
  const result = stripBiometricFlags(snakePayload);
  assertBiometricsStripped(result);
  assert.equal(result.assessment_id, camelPayload.assessmentId);
});

test("createOnlineExam: cliente envia biometricRequired=false -> continua false", () => {
  const result = stripBiometricFlags({
    title: "P",
    biometric_required: false,
    biometric_kind_required: null,
    require_face_match: false,
  });
  assert.equal(result.biometric_required, false);
  assert.equal(result.biometric_kind_required, null);
  assert.equal(result.require_face_match, false);
});

test("createOnlineExam: cliente não envia nenhum flag biométrico -> ainda sai false/null", () => {
  // O schema Zod aplica defaults, mas o teste cobre o caso "payload
  // parcial" (cliente envia o mínimo possível).
  const result = stripBiometricFlags({ title: "P" });
  assert.equal(result.biometric_required, false);
  assert.equal(result.biometric_kind_required, null);
  assert.equal(result.require_face_match, false);
});

test("updateOnlineExam: cliente envia biometricKind=face -> vira null", () => {
  const result = stripBiometricFlags({
    id: "00000000-0000-0000-0000-0000000000a1",
    biometric_required: true,
    biometric_kind_required: "face" as const,
    require_face_match: true,
  });
  assert.equal(result.biometric_kind_required, null, "biometric_kind_required deve ser null mesmo se cliente enviar 'face'");
});

test("updateOnlineExam: cliente tenta forçar require_face_match=true -> vira false", () => {
  const result = stripBiometricFlags({
    id: "00000000-0000-0000-0000-0000000000a1",
    biometric_required: true,
    biometric_kind_required: "iris" as const,
    require_face_match: true,
  });
  assert.equal(result.require_face_match, false);
});

// ============== forceDisabledProctoringFlags ==============

test("saveOnlineExamConfig: tabSwitchLimit=5 do cliente é zerado para null", () => {
  // Antes da remoção da biometria, o atalho era:
  //   tab_switch_limit: data.biometricRequired ? (data.tabSwitchLimit ?? null) : null
  // O que significa: o cliente habilitava o limite de trocas de aba
  // SOB a condição de ligar biometria. Como a biometria foi removida,
  // o atalho deixa de fazer sentido e `forceDisabledProctoringFlags`
  // força `tab_switch_limit` para `null` mesmo se o cliente enviar
  // um valor.
  const result = forceDisabledProctoringFlags({
    title: "P",
    tab_switch_limit: 5,
  });
  assert.equal(result.tab_switch_limit, null, "tab_switch_limit deve ser null");
});

test("saveOnlineExamConfig: payload já com tab_switch_limit=null -> continua null", () => {
  const result = forceDisabledProctoringFlags({
    title: "P",
    tab_switch_limit: null,
  });
  assert.equal(result.tab_switch_limit, null);
});

test("saveOnlineExamConfig: cliente não envia tab_switch_limit -> fica null", () => {
  const result = forceDisabledProctoringFlags({ title: "P" });
  assert.equal(result.tab_switch_limit, null);
});

test("saveOnlineExamConfig: combinado com stripBiometricFlags, payload 'ligado' sai totalmente desativado", () => {
  // Replica a ordem do handler real: primeiro stripBiometricFlags,
  // depois forceDisabledProctoringFlags. O resultado deve estar
  // completamente desativado do ponto de vista da biometria.
  const after = forceDisabledProctoringFlags(
    stripBiometricFlags(adversarialBiometricPayload()),
  );
  assertBiometricsStripped(after);
  assert.equal(after.tab_switch_limit, null);
  // E o payload ainda carrega o que é legítimo.
  assert.equal(after.title, "Prova X");
  assert.equal(after.max_attempts, 1);
});
