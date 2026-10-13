// Lógica pura do módulo `online-exams.functions.ts`, sem dependência
// de Supabase, `createServerFn` ou middlewares do TanStack Start.
//
// Cobre a decisão de produto "biometria removida":
//   * stripBiometricFlags: zera os 3 flags biométricos do payload
//     independentemente do que o cliente enviar.
//   * forceDisabledProctoringFlags: zera `tab_switch_limit` para `null`,
//     já que o atalho que ligava esse campo à biometria foi removido.
//
// Os 3 server fns (createOnlineExam, updateOnlineExam,
// saveOnlineExamConfig) chamam estas funções puras passando
// `supabaseAdmin` / `notifyTeacherOfSubmission` como dependências
// (mesmo padrão de `submissions-pure.ts`).
//
// IMPORTANTE: createOnlineExam e updateOnlineExam historicamente NÃO
// condicionavam `tab_switch_limit` à biometria. A mudança que zera
// `tab_switch_limit` foi aplicada apenas em `saveOnlineExamConfig`
// (a única que tinha o atalho). Por isso `forceDisabledProctoringFlags`
// é aplicado só nesse fluxo e o teste reflete esse escopo.

/** Zera os flags de biometria independentemente do que o cliente enviar.
 *  A biometria foi removida por decisão de produto; enquanto as colunas
 *  existirem no schema, persistimos sempre `false` / `null`. */
export function stripBiometricFlags<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "biometric_required" | "biometric_kind_required" | "require_face_match"> & {
  biometric_required: false;
  biometric_kind_required: null;
  require_face_match: false;
} {
  const { biometric_required, biometric_kind_required, require_face_match, ...rest } = payload as T & {
    biometric_required?: unknown;
    biometric_kind_required?: unknown;
    require_face_match?: unknown;
  };
  void biometric_required;
  void biometric_kind_required;
  void require_face_match;
  return {
    ...(rest as Omit<T, "biometric_required" | "biometric_kind_required" | "require_face_match">),
    biometric_required: false,
    biometric_kind_required: null,
    require_face_match: false,
  };
}

/** Zera `tab_switch_limit` para `null` (decisão: biometria removida, o
 *  atalho que habilitava esse campo quando o professor ligava
 *  biometria não faz mais sentido). Aplica-se apenas ao fluxo
 *  `saveOnlineExamConfig`. */
export function forceDisabledProctoringFlags<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "tab_switch_limit"> & { tab_switch_limit: null } {
  const { tab_switch_limit, ...rest } = payload as T & { tab_switch_limit?: unknown };
  void tab_switch_limit;
  return {
    ...(rest as Omit<T, "tab_switch_limit">),
    tab_switch_limit: null,
  };
}
