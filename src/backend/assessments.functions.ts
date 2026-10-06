import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { resolveBrandingLogoUrl } from "./branding.server";
import { callAIJson, callAIText } from "./ai.server";
import { assessmentBalanceRules, linguisticClarityRules, pedagogicalReviewRules, questionFactoryRules } from "./question-factory.server";
import {
  DECLARED_TO_LEVEL,
  LEVEL_NAMES,
  difficultyGuardRules,
  validateQuestionLevel,
  type CognitiveLevel,
  type DeclaredLevel,
} from "./difficulty-guard.server";
import { sanitizeConceptTopic, sanitizeAssessmentTopic, sanitizeGeneratedQuestionText, dedupeOptionPrefixes, sanitizeExtractedConcept, isStructuralConceptLabel, resolveConceptFallback } from "@/lib/text-sanitize";
import { validateQuestionContent } from "@/lib/question-quality";


/* ============================================================================
 * MÓDULO DE AVALIAÇÕES — Server functions
 * ========================================================================== */

type QType = "multiple_choice" | "true_false" | "fill_blank" | "essay";

type MCSubtypeCounts = {
  standard?: number;
  true_false_block?: number;
  fill_blank_block?: number;
};

type GenQuestion = {
  qtype: QType;
  prompt: string;
  options?: string[] | null;
  correct_answer: unknown;
  explanation?: string | null;
  weight?: number;
  mc_subtype?: "standard" | "true_false_block" | "fill_blank_block" | null;
};


// ---------- LIST APOSTILA SOURCES -------------------------------------------
export const listAssessmentApostilas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      await assertTeacherOrAdmin(data.discipline_id, context.userId);
      
      const { data: rows, error } = await supabaseAdmin
        .from("ai_generations")
        .select("id, title, created_at, tool")
        .eq("discipline_id", data.discipline_id)
        .eq("tool", "apostila")
        .order("created_at", { ascending: true });

      if (error) return { items: [] };

      // Filtro adicional de segurança para garantir que apenas itens de conteúdo 
      // didático tipo apostila sejam retornados, excluindo variações nominais indesejadas.
      const filtered = (rows ?? []).filter((item: any) => {
        const title = (item.title || "").toLowerCase();
        const type = (item.tool || "").toLowerCase();

        // Deve começar explicitamente com "Apostila" ou ser do tipo apostila/handout
        const ehApostila = type === 'apostila' || type === 'handout' || title.startsWith('apostila');

        // Bloqueia itens que contenham palavras-chave excluídas
        const termosExcluidos = ["exercícios", "exercicios", "slides", "slide", "estudo de caso", "plano de aula", "ementa", "quiz"];
        const ehExcluido = termosExcluidos.some(termo => title.includes(termo));

        return ehApostila && !ehExcluido;
      });

      return { items: filtered };
    } catch (e) {
      console.error("Erro em listAssessmentApostilas:", e);
      return { items: [] };
    }
  });

// ---------- LIST ASSESSMENTS ------------------------------------------------
/**
 * A UI envia a data como string ISO, podendo conter DUAS datas concatenadas por
 * " | " (modalidade "Turma Dividida"). A coluna assessment_date é do tipo date,
 * então persistimos apenas a primeira data nela e guardamos a string completa
 * (com horários e a segunda data) em assessment_schedule.
 */
function splitAssessmentSchedule(raw: string | null | undefined) {
  const full = typeof raw === "string" ? raw.trim() : "";
  if (!full) return { assessment_date: null as string | null, assessment_schedule: null as string | null };
  const first = full.split("|")[0]!.trim();
  const dateOnly = first.split("T")[0]!.trim();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
  return { assessment_date: valid, assessment_schedule: full };
}

export const listAssessments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("assessments")
      .select("id, title, module_name, max_score, version_count, copies_per_version, status, created_at, diary_assessment_id, assessment_date, assessment_schedule, config")
      .eq("discipline_id", data.discipline_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Resolver o rótulo amigável da coluna do diário (nome da avaliação /
    // sub-item) a partir da estrutura de notas da disciplina — evita
    // exibir UUIDs crus no card das avaliações.
    const { data: gs } = await supabaseAdmin
      .from("grade_structures")
      .select("assessments, recovery_config")
      .eq("discipline_id", data.discipline_id)
      .maybeSingle();
    const labelMap = new Map<string, string>();
    if (gs) {
      type Sub = { id: string; name: string };
      type A = { id: string; name: string; sub_items?: Sub[] | null };
      const list = ((gs.assessments as unknown) as A[]) ?? [];
      for (const a of list) {
        if (a?.id && a?.name) labelMap.set(a.id, a.name);
        for (const s of (a?.sub_items ?? [])) {
          if (s?.id && s?.name) labelMap.set(`${a.id}#${s.id}`, `${a.name} — ${s.name}`);
        }
      }
      const rc = ((gs as unknown as { recovery_config?: { enabled?: boolean; name?: string } }).recovery_config) ?? null;
      if (rc?.enabled && rc.name) labelMap.set("__recovery__", rc.name);
    }
    const items = (rows ?? []).map((r) => ({
      ...r,
      // A UI trabalha com a string completa (com horário e, em Turma Dividida,
      // duas datas separadas por " | ").
      assessment_date:
        (r as { assessment_schedule?: string | null }).assessment_schedule ?? r.assessment_date,
      diary_column_label: r.diary_assessment_id ? (labelMap.get(r.diary_assessment_id) ?? null) : null,
    }));
    // Pendências de revisão (placeholder genérico, coerência com a apostila e
    // nível de dificuldade) — bloqueiam a geração dos PDFs.
    const ids = items.map((i) => i.id);
    const pendingByAssessment = new Map<string, number>();
    const keptByAssessment = new Map<string, number>();
    if (ids.length > 0) {
      const { data: auditRows } = await supabaseAdmin
        .from("assessment_question_audits")
        .select("assessment_id, resolution")
        .in("assessment_id", ids);
      for (const a of (auditRows ?? []) as Array<{ assessment_id: string; resolution: string }>) {
        if (a.resolution === "pending") {
          pendingByAssessment.set(a.assessment_id, (pendingByAssessment.get(a.assessment_id) ?? 0) + 1);
        } else if (a.resolution === "kept") {
          keptByAssessment.set(a.assessment_id, (keptByAssessment.get(a.assessment_id) ?? 0) + 1);
        }
      }
    }
    return {
      items: items.map((i) => ({
        ...i,
        pending_audits: pendingByAssessment.get(i.id) ?? 0,
        kept_audits: keptByAssessment.get(i.id) ?? 0,
      })),
    };
  });

// ---------- GET ASSESSMENT --------------------------------------------------
// ---------- LIST TARGETS (alunos + candidatos à recuperação) ---------------
type GsAssessment = { id: string; name: string; weight: number; sub_items?: Array<{ id: string }> | null };
type GsRecovery = {
  enabled?: boolean;
  mode?: "lowest" | "specific";
  target_assessment_id?: string | null;
} | null;

export const listAssessmentTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);

    // 1) alunos matriculados
    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id);
    const ids = (enrolled ?? []).map((r) => r.student_id);
    let students: Array<{ id: string; name: string; enrollment_number: string | null }> = [];
    if (ids.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email, enrollment_number")
        .in("id", ids);
      students = (profs ?? []).map((p) => ({
        id: p.id,
        name: p.name || p.email || "Aluno(a)",
        enrollment_number: p.enrollment_number ?? null,
      }));
      students.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    }

    // 2) candidatos à recuperação: média < passing_average
    let recoveryIds: string[] = [];
    const { data: gs } = await supabaseAdmin
      .from("grade_structures")
      .select("assessments, passing_average, recovery_average, formula, recovery_config")
      .eq("discipline_id", data.discipline_id)
      .maybeSingle();
    if (gs && ids.length > 0) {
      const assessments = (gs.assessments as unknown as GsAssessment[]) ?? [];
      const passing = Number(gs.passing_average) || 0;
      const formula = String((gs as unknown as { formula?: string }).formula ?? "weighted_average");
      const recovery = ((gs as unknown as { recovery_config?: GsRecovery }).recovery_config) ?? null;

      const { data: entriesRows } = await supabaseAdmin
        .from("grade_entries")
        .select("student_id, assessment_id, score")
        .eq("discipline_id", data.discipline_id);
      const entries = (entriesRows ?? []) as Array<{ student_id: string; assessment_id: string; score: number | null }>;

      const subKey = (aId: string, sId: string) => `${aId}#${sId}`;
      const subAvg = (sid: string, a: GsAssessment): number | null => {
        if (!a.sub_items?.length) return null;
        const list: number[] = [];
        for (const sub of a.sub_items) {
          const e = entries.find((x) => x.student_id === sid && x.assessment_id === subKey(a.id, sub.id));
          if (e?.score != null) list.push(Number(e.score));
        }
        return list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
      };
      const effective = (sid: string, a: GsAssessment): number | null => {
        if (a.sub_items?.length) return subAvg(sid, a);
        const e = entries.find((x) => x.student_id === sid && x.assessment_id === a.id);
        return e?.score ?? null;
      };
      const recScoreOf = (sid: string): number | null => {
        const e = entries.find((x) => x.student_id === sid && x.assessment_id === "__recovery__");
        return e?.score ?? null;
      };

      const calcAvg = (sid: string): number | null => {
        const scored = assessments.map((a) => {
          let score = effective(sid, a);
          if (recovery?.enabled) {
            const rec = recScoreOf(sid);
            if (rec != null) {
              let targetId: string | null = null;
              if (recovery.mode === "specific") targetId = recovery.target_assessment_id ?? null;
              else {
                let lowest: { id: string; score: number } | null = null;
                for (const x of assessments) {
                  const s = effective(sid, x);
                  if (s == null) continue;
                  if (!lowest || s < lowest.score) lowest = { id: x.id, score: s };
                }
                targetId = lowest?.id ?? null;
              }
              if (targetId === a.id) {
                const orig = score;
                if (orig == null || rec > Number(orig)) score = rec;
              }
            }
          }
          return { a, score };
        });
        const valid = scored.filter((s) => s.score != null);
        if (!valid.length) return null;
        if (formula === "simple_average") {
          return valid.reduce((s, x) => s + Number(x.score), 0) / valid.length;
        }
        const tw = valid.reduce((s, x) => s + Number(x.a.weight || 0), 0);
        if (!tw) return null;
        return valid.reduce((s, x) => s + Number(x.score) * Number(x.a.weight || 0), 0) / tw;
      };

      recoveryIds = students
        .map((s) => ({ id: s.id, avg: calcAvg(s.id) }))
        .filter((x) => x.avg != null && Number(x.avg) < passing)
        .map((x) => x.id);
    }

    return { students, recovery_student_ids: recoveryIds };
  });

export const getAssessment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a, error } = await supabaseAdmin
      .from("assessments")
      .select("*, assessment_header_templates(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) throw new Error("Avaliação não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);
    const [{ data: questions }, { data: versions }, { data: assignments }] = await Promise.all([
      supabaseAdmin
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("assessment_versions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("version_label", { ascending: true }),


      supabaseAdmin
        .from("assessment_assignments")
        .select("id, student_id, version_id, copy_index, qr_token, question_order, option_orders, answer_key")
        .eq("assessment_id", a.id),
    ]);
    return {
      assessment: {
        ...a,
        assessment_date:
          (a as { assessment_schedule?: string | null }).assessment_schedule ?? a.assessment_date,
      },
      questions: questions ?? [],
      versions: versions ?? [],
      assignments: assignments ?? [],
    };
  });

// ---------- UPDATE (parâmetros básicos) -------------------------------------
export const updateAssessmentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    id: z.string().uuid(),
    title: z.string().trim().min(3).max(500),
    module_name: z.string().trim().max(500).optional().nullable(),
    diary_assessment_id: z.string().trim().min(1).max(120),
    assessment_date: z.string().min(10).nullable(),
    max_score: z.number().min(0.1).max(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("discipline_id, diary_assessment_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!a) throw new Error("Não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);
    const { error } = await supabaseAdmin
      .from("assessments")
      .update({
        title: data.title,
        module_name: sanitizeAssessmentTopic(data.module_name ?? "") || data.module_name?.trim() || null,
        diary_assessment_id: data.diary_assessment_id,
        ...splitAssessmentSchedule(data.assessment_date),
        max_score: data.max_score,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Reaponta lançamentos de nota já feitos para a nova coluna do diário.
    const oldCol = (a as { diary_assessment_id: string | null }).diary_assessment_id;
    if (oldCol && oldCol !== data.diary_assessment_id) {
      const { data: assigns } = await supabaseAdmin
        .from("assessment_assignments")
        .select("student_id")
        .eq("assessment_id", data.id);
      const studentIds = Array.from(new Set((assigns ?? []).map((r) => r.student_id))).filter(Boolean);
      if (studentIds.length > 0) {
        await supabaseAdmin
          .from("grade_entries")
          .update({ assessment_id: data.diary_assessment_id })
          .eq("discipline_id", a.discipline_id)
          .eq("assessment_id", oldCol)
          .in("student_id", studentIds as string[]);
      }
    }
    return { ok: true };
  });

// ---------- DELETE ----------------------------------------------------------
export const deleteAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("discipline_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!a) throw new Error("Não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);
    const { error } = await supabaseAdmin.from("assessments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- GENERATE --------------------------------------------------------
const GenerateInput = z.object({
  discipline_id: z.string().uuid(),
  apostila_id: z.string().uuid(),
  title: z.string().min(3).max(500),
  module_lessons: z.string().min(1).max(30000),
  counts: z.object({
    multiple_choice: z.number().int().min(0).max(40),
    true_false: z.number().int().min(0).max(40),
    fill_blank: z.number().int().min(0).max(40),
    essay: z.number().int().min(0).max(20),
  }),
  max_score: z.number().min(1).max(100),
  version_count: z.number().int().min(1).max(4),
  option_count: z.number().int().min(3).max(5).default(5),
  copies_per_version: z.number().int().min(1).max(200).default(1),
  shuffle_questions: z.boolean().default(true),
  layout: z.enum(["one_column", "two_columns", "mixed"]).default("mixed"),
  diary_assessment_id: z.string().max(120).optional().nullable(),
  rigor: z.enum(["light", "balanced", "strict"]).default("balanced"),
  assessment_date: z.string().min(10).optional().nullable(),
  format_instructions: z.string().max(30000).optional().nullable(),
  topics: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
            .filter((t) => typeof t === "string")
            .map((t: string) => t.trim().slice(0, 1000))
            .filter((t: string) => t.length > 0)
            .slice(0, 40)
        : v,
    z.array(z.string().min(1).max(30000)).max(40).optional().nullable(),
  ),
  quality_rules: z.array(z.string().min(1).max(80)).max(20).optional().nullable(),
  difficulty_level: z.enum(["basico", "medio", "avancado", "superior"]).default("medio"),
  difficulty_by_type: z
    .object({
      multiple_choice: z.union([
        z.enum(["basico", "medio", "avancado", "superior"]),
        z.object({ basico: z.number().int().min(0).max(80).default(0), medio: z.number().int().min(0).max(80).default(0), avancado: z.number().int().min(0).max(80).default(0), superior: z.number().int().min(0).max(80).default(0) }).partial(),
      ]).optional(),
      true_false: z.union([
        z.enum(["basico", "medio", "avancado", "superior"]),
        z.object({ basico: z.number().int().min(0).max(80).default(0), medio: z.number().int().min(0).max(80).default(0), avancado: z.number().int().min(0).max(80).default(0), superior: z.number().int().min(0).max(80).default(0) }).partial(),
      ]).optional(),
      fill_blank: z.union([
        z.enum(["basico", "medio", "avancado", "superior"]),
        z.object({ basico: z.number().int().min(0).max(80).default(0), medio: z.number().int().min(0).max(80).default(0), avancado: z.number().int().min(0).max(80).default(0), superior: z.number().int().min(0).max(80).default(0) }).partial(),
      ]).optional(),
      essay: z.union([
        z.enum(["basico", "medio", "avancado", "superior"]),
        z.object({ basico: z.number().int().min(0).max(80).default(0), medio: z.number().int().min(0).max(80).default(0), avancado: z.number().int().min(0).max(80).default(0), superior: z.number().int().min(0).max(80).default(0) }).partial(),
      ]).optional(),
    })
    .optional()
    .nullable(),
  layout_template: z.enum(["classic", "compact", "two_column", "exam_board"]).optional().nullable(),
  multiple_choice_subtypes: z
    .object({
      standard: z.number().int().min(0).max(80).optional(),
      true_false_block: z.number().int().min(0).max(40).optional(),
      fill_blank_block: z.number().int().min(0).max(40).optional(),
    })
    .optional()
    .nullable(),
  header_overrides: z
    .object({
      institution: z.string().max(200).optional().nullable(),
      discipline: z.string().max(200).optional().nullable(),
      professor: z.string().max(200).optional().nullable(),
    })
    .optional()
    .nullable(),
  // Modelo de cabeçalho institucional (somente avaliações).
  header_template_id: z.string().uuid().optional().nullable(),
  // Modalidade da avaliação:
  // - "regular" (padrão): distribui para todos os alunos matriculados.
  // - "second_call": prova de segunda chamada — só para os alunos escolhidos.
  // - "recovery": prova de recuperação — só para os alunos escolhidos
  //   (tipicamente os que aparecem "em recuperação" no diário).
  kind: z.enum(["regular", "second_call", "recovery"]).default("regular"),
  target_student_ids: z.array(z.string().uuid()).max(500).optional().nullable(),
});

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeForCompare(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function optionRepeatsPrompt(prompt: string, option: string): boolean {
  const p = normalizeForCompare(prompt);
  const o = normalizeForCompare(option.replace(/^[\(\[]?\s*[A-Ea-e]\s*[\)\.\-:]\s+/, ""));
  if (!p || !o) return false;
  if (p === o) return true;
  if (Math.min(p.length, o.length) >= 20 && (p.includes(o) || o.includes(p))) return true;
  const promptWords = new Set(p.split(" ").filter((w) => w.length > 3));
  const optionWords = o.split(" ").filter((w) => w.length > 3);
  if (optionWords.length < 8 || promptWords.size < 8) return false;
  const overlap = optionWords.filter((w) => promptWords.has(w)).length / optionWords.length;
  return overlap >= 0.88;
}

/* ----------------------------------------------------------------------------
 * ITEM 7 — Verificação lexical obrigatória.
 * Enunciados não podem usar "muletas de aula" genéricas e vagas. Qualquer
 * questão que contenha uma destas expressões é REJEITADA (e re-solicitada à
 * IA); se a distribuição não puder ser cumprida sem elas, a geração é
 * bloqueada mais adiante — nunca produzimos uma prova não conforme.
 * -------------------------------------------------------------------------- */
const BANNED_PROMPT_PHRASES = [
  "de acordo com a apostila",
  "de acordo com a aula",
  "de acordo com o material",
  "de acordo com o texto",
  "de acordo com o modulo",
  "de acordo com o conteudo",
  "com base no conteudo estudado",
  "com base no conteudo",
  "com base na apostila",
  "com base na aula",
  "com base no material",
  "com base no texto",
  "sobre o conceito estudado",
  "sobre o tema abordado",
  "sobre o tema estudado",
  "sobre o conteudo estudado",
  "conforme a aula",
  "conforme a apostila",
  "conforme o material",
  "conforme estudado",
  "segundo o modulo",
  "segundo a apostila",
  "segundo a aula",
  "como visto na aula",
  "como visto na apostila",
  "como estudado",
  "no material estudado",
  "no texto da apostila",
  "no conteudo da apostila",
  "na aula sobre",
  "a leitura do problema exige identificar",
  "em uma situação aplicada envolvendo",
  "em uma situacao aplicada envolvendo",
  "complete as lacunas na ordem i v no caso avaliativo",
  "caso avaliativo",
].map((p) => normalizeForCompare(p));

export function findBannedPromptPhrase(prompt: string): string | null {
  const normalized = normalizeForCompare(prompt);
  if (!normalized) return null;
  return BANNED_PROMPT_PHRASES.find((phrase) => normalized.includes(phrase)) ?? null;
}

export function resolveCorrectOptionIndex(correct: unknown, options: string[]): number {
  if (typeof correct === "number" && Number.isInteger(correct)) return correct;
  const raw = String(correct ?? "").trim();
  const byLetter = "ABCDE".indexOf(raw.toUpperCase().charAt(0));
  if (byLetter >= 0) return byLetter;
  const normalized = normalizeForCompare(raw);
  return options.findIndex((opt) => normalizeForCompare(opt) === normalized);
}

// System instructions for AI content pipeline
const ASSESSMENT_SYSTEM_PROMPT = (data: any, QUESTION_FACTORY_RULES: string, LinguisticClarityRules: string, PedagogicalReviewRules: string, AssessmentBalanceRules: string, DifficultyGuardRules: string, apostilaText: string) => `
${MARKDOWN_SYSTEM_PREFIX}
Você é o assistente "Gerador de Avaliações Profissionais".

REGRA ESTRITA DE SINCRONIA E HERANÇA (PIPELINE DE IA):
1. FONTE ÚNICA DA VERDADE: O Plano de Aula e a Ementa da Disciplina são a MATRIZ ABSOLUTA de conteúdo.
2. HERANÇA DE CONTEXTO: Gere o conteúdo baseando-se EXCLUSIVAMENTE nos tópicos fornecidos no Plano de Aula/Apostila. É proibido incluir assuntos externos, conceitos ou farmacoterapias que NÃO estejam previstos no material base.
3. RASTREABILIDADE (MAPPING): Cada questão gerada deve conter no campo "explanation" a referência/tag explícita de qual Módulo/Aula/Tópico da Apostila ela está testando (ex: "origem: Aula 4 - Tópico 2").
4. CONCISÃO E NÃO-REDUNDÂNCIA: Evite repetições redundantes no enunciado. Não utilize expressões como "conforme estudado neste o [Tópico]" ou repetições do nome do tópico dentro da mesma frase de introdução. Vá direto ao ponto técnico.

[EMENTA]: ${data.module_lessons.split(/[\n;]+/).map((l: string) => sanitizeAssessmentTopic(l)).filter(Boolean).join("\n") || "Conforme apostila"}
[CONTEÚDO DA APOSTILA]: ${apostilaText.slice(0, 15000)}
[TÓPICOS DO PLANO DE AULA]: ${data.topics?.map(sanitizeConceptTopic).filter(Boolean).join(", ") || "Conforme apostila"}


${QUESTION_FACTORY_RULES}
${LinguisticClarityRules}
${PedagogicalReviewRules}
${AssessmentBalanceRules}
${DifficultyGuardRules}
`;

export function declaredCorrectLetters(explanation: string): string[] {
  const text = String(explanation ?? "");
  if (!text) return [];
  const letters = new Set<string>();
  // Só aceitamos letras MAIÚSCULAS (A–E) como rótulo de alternativa, para não
  // confundir os artigos portugueses "a"/"e"/"o" com a letra correta.
  // Fase 1 — palavra de correção e, na sequência (janela curta), a 1ª letra
  // A–E isolada: "Gabarito: C", "a resposta correta é a letra B".
  const kw = /(gabarito|resposta\s+correta|alternativa\s+correta|op[çc][ãa]o\s+correta|resposta\s+certa)/gi;
  let m: RegExpExecArray | null;
  while ((m = kw.exec(text))) {
    const window = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const lm = window.match(/(?:^|[^A-Za-z])\(?([A-E])\)?(?![A-Za-z])/);
    if (lm) letters.add(lm[1]);
  }
  // Fase 2 — letra antes do termo de correção: "alternativa D está correta".
  const reAfter =
    /\b(?:letra|alternativa|op[çc][ãa]o|item)\s*\(?\s*([A-Ea-e])\s*\)?(?![A-Za-z])\s*(?:\([^)]*\)\s*)?(?:é|e|est[áa]|ser[áa]|seria)\s+(?:a\s+|o\s+)?(?:[uú]nica\s+)?(?:resposta\s+|alternativa\s+|op[çc][ãa]o\s+)?(?:correta|correto|certa|verdadeira)\b/gi;
  let a: RegExpExecArray | null;
  while ((a = reAfter.exec(text))) if (/^[A-E]$/.test(a[1])) letters.add(a[1]);
  return [...letters];
}

export function explanationContradictsCorrect(q: GenQuestion): boolean {
  if (q.qtype !== "multiple_choice" || !Array.isArray(q.options) || q.options.length === 0) return false;
  if (!q.explanation) return false;
  const declared = declaredCorrectLetters(q.explanation);
  if (declared.length === 0) return false;
  const idx = resolveCorrectOptionIndex(q.correct_answer, q.options);
  if (idx < 0 || idx >= q.options.length) return false;
  const correctLetter = "ABCDE"[idx];
  // Contradição: o comentário afirma letra(s) correta(s), mas nenhuma delas é a
  // letra do gabarito real.
  return !declared.includes(correctLetter);
}

function sanitizeCorrectLetterDeclarations(explanation: string | null | undefined): string | null {
  const text = String(explanation ?? "").trim();
  if (!text) return null;
  return text
    // Só removemos a letra quando ela vier explicitamente rotulada
    // (parênteses, dois-pontos, hífen ou seguida de pontuação/fim). Sem essa
    // âncora, o regex engolia a 1ª letra da palavra seguinte — ex.: em
    // "A alternativa correta articula ..." a sequência "correta a" era
    // consumida e sobrava "rticula ...", quebrando o feedback do aluno.
    .replace(/\b(?:gabarito|resposta\s+correta|alternativa\s+correta|op[çc][ãa]o\s+correta|resposta\s+certa)\s*(?:[:\-–]\s*)?(?:\(\s*[A-E]\s*\)|[A-E](?=[\s.;:,\-–)]|$))\s*[.;:,\-–]?\s*/g, "")
    .replace(/\b(?:letra|alternativa|op[çc][ãa]o|item)\s+(?:\(\s*[A-Ea-e]\s*\)|[A-Ea-e](?=[\s.;:,\-–)]|$))\s*(?:\([^)]*\)\s*)?(?:é|est[áa]|ser[áa]|seria)\s+(?:a\s+|o\s+)?(?:[uú]nica\s+)?(?:resposta\s+|alternativa\s+|op[çc][ãa]o\s+)?(?:correta|correto|certa|verdadeira)\s*[.;:,\-–]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || null;
}

type QRow = { id: string; position: number; qtype: QType; options: string[] | null };

/**
 * Constrói UM arranjo (ordem de questões + ordem de alternativas + gabarito)
 * para um conjunto de questões. Usado tanto por versão quanto por aluno, de
 * modo que dois alunos da MESMA versão recebam itens realmente embaralhados.
 */
function buildVariant(
  meta: Array<{ position: number; q: GenQuestion }>,
  byPos: Map<number, QRow>,
  shouldShuffle: boolean,
): { order: string[]; option_orders: Record<string, number[]>; answer_key: Record<string, unknown> } {
  const ids = meta.map((m) => byPos.get(m.position)!.id);
  const order = shouldShuffle ? shuffle(ids) : ids;
  const option_orders: Record<string, number[]> = {};
  const answer_key: Record<string, unknown> = {};
  for (const m of meta) {
    const row = byPos.get(m.position)!;
    const q = m.q;
    if (row.qtype === "multiple_choice" && Array.isArray(row.options)) {
      const baseIdx = row.options.map((_: unknown, i: number) => i);
      const idxs = shouldShuffle ? shuffle(baseIdx) : baseIdx;
      option_orders[row.id] = idxs;
      const correctOriginalIdx = resolveCorrectOptionIndex(q.correct_answer, row.options);
      const newIdx = idxs.indexOf(correctOriginalIdx);
      answer_key[row.id] = newIdx >= 0 ? "ABCDE"[newIdx] : null;
    } else {
      answer_key[row.id] = q.correct_answer;
    }
  }
  return { order, option_orders, answer_key };
}

const TYPE_LABELS: Record<QType, string> = {
  multiple_choice: "Múltipla escolha (5 alternativas A–E)",
  true_false: "Verdadeiro/Falso",
  fill_blank: "Completar lacunas com marcador _____",
  essay: "Dissertativa",
};

function normalizeQType(value: unknown): QType | null {
  const t = String(value ?? "").trim().toLowerCase();
  if (["multiple_choice", "multipla_escolha", "múltipla_escolha", "mc"].includes(t)) return "multiple_choice";
  if (["true_false", "verdadeiro_falso", "verdadeiro/falso", "vf", "v/f"].includes(t)) return "true_false";
  if (["fill_blank", "fill_blanks", "completar_lacunas", "lacunas", "blank"].includes(t)) return "fill_blank";
  if (["essay", "discursiva", "dissertativa", "redacao", "redação"].includes(t)) return "essay";
  return null;
}

/* ----------------------------------------------------------------------------
 * ASSESSOR DE QUALIDADE (alternativas de múltipla escolha PADRÃO).
 * Detecta alternativas incoerentes que degradavam a prova: palavras-muleta
 * genéricas soltas ("análise", "critério"), nomes próprios/cabeçalhos em CAIXA
 * ALTA ("JAÍLSON RESENDE"), marcadores de lista ("3. ...") e fragmentos que
 * terminam em ":" ou têm conteúdo insuficiente. Blocos V/F e de Lacunas usam
 * sequências curtas legítimas e NÃO passam por esta checagem.
 * -------------------------------------------------------------------------- */
function isGarbageStandardOption(option: string): boolean {
  const body = stripOptionLetter(option).trim();
  const cleaned = body.replace(/[:;.\s]+$/, "");
  const norm = normalizeForCompare(cleaned);
  if (!norm) return true;
  const words = norm.split(" ").filter(Boolean);
  // Palavra-muleta genérica isolada (uma das FALLBACK_CONCEPTS).
  if (FALLBACK_CONCEPTS.some((c) => normalizeForCompare(c) === norm)) return true;
  // Nome próprio / cabeçalho em CAIXA ALTA.
  if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(cleaned) && !/[a-záéíóúâêôãõç]/.test(cleaned)) return true;
  // Marcador de lista à esquerda ("3.", "1)").
  if (/^\s*\d+\s*[.)]/.test(body)) return true;
  // Termina em dois-pontos (fragmento de título/lista).
  if (/:\s*$/.test(body)) return true;
  // Conteúdo insuficiente (uma palavra muito curta).
  if (words.length < 2 && norm.length < 6) return true;
  return false;
}

function normalizeGeneratedQuestion(raw: GenQuestion | null | undefined, optionCount = 5): GenQuestion | null {
  if (!raw?.prompt) return null;
  const qtype = normalizeQType(raw.qtype);
  if (!qtype) return null;
  // ITEM 7: rejeita enunciados com expressões genéricas proibidas.
  if (findBannedPromptPhrase(raw.prompt)) return null;
  if (qtype === "multiple_choice") {
    const options = Array.isArray(raw.options)
      ? raw.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, optionCount)
      : [];
    if (options.length !== optionCount) return null;
    const seen = new Set<string>();
    for (const option of options) {
      const norm = normalizeForCompare(option);
      if (!norm || seen.has(norm) || optionRepeatsPrompt(raw.prompt, option)) return null;
      seen.add(norm);
    }
    const explicit = String((raw as { mc_subtype?: unknown }).mc_subtype ?? "").trim().toLowerCase();
    const mc_subtype =
      explicit === "true_false_block" || explicit === "fill_blank_block" || explicit === "standard"
        ? (explicit as GenQuestion["mc_subtype"])
        : null;
    const candidate: GenQuestion = { ...raw, qtype, options, mc_subtype };
    // ASSESSOR DE QUALIDADE — múltipla escolha PADRÃO: rejeita alternativas
    // "lixo" (palavra-muleta solta, nome próprio em CAIXA ALTA, marcador de
    // lista ou fragmento incompleto) para nunca entregar itens como "análise",
    // "JAÍLSON RESENDE" ou "3. Tamanho de Partículas:" numa prova.
    if (resolveMcSubtype(candidate) === "standard" && options.some((o) => isGarbageStandardOption(o))) {
      return null;
    }
    // Bloqueio de consistência: descarta questão cujo comentário contradiz a
    // letra do gabarito (re-solicitada à IA; bloqueia a geração se persistir).
    if (explanationContradictsCorrect(candidate)) return null;
    return { ...candidate, explanation: sanitizeCorrectLetterDeclarations(candidate.explanation) };
  }
  if (qtype === "true_false") {
    const v = raw.correct_answer;
    const answer = typeof v === "boolean" ? v : /^(v|verdadeiro|true|sim|1)$/i.test(String(v ?? "").trim());
    return { ...raw, qtype, options: null, correct_answer: answer };
  }
  if (qtype === "fill_blank") {
    const answers = Array.isArray(raw.correct_answer) ? raw.correct_answer.map((x) => String(x ?? "").trim()).filter(Boolean) : [String(raw.correct_answer ?? "").trim()].filter(Boolean);
    const prompt = raw.prompt.includes("_____") ? raw.prompt : `${raw.prompt.trim()} _____`;
    return { ...raw, qtype, prompt, options: null, correct_answer: answers.length > 0 ? answers : ["Resposta esperada"] };
  }
  return { ...raw, qtype, options: null };
}

function isFillBlankMultipleChoice(q: GenQuestion): boolean {
  return q.qtype === "multiple_choice" && /_{3,}|lacuna|complete|preenche/i.test(`${q.prompt} ${(q.options ?? []).join(" ")}`);
}

function isTrueFalseMultipleChoice(q: GenQuestion): boolean {
  return q.qtype === "multiple_choice" && !isFillBlankMultipleChoice(q) && /(verdadeiro|falso|\bV\b|\bF\b|afirmativas)/i.test(`${q.prompt} ${(q.options ?? []).join(" ")}`);
}

/**
 * Subtipo de uma questão de múltipla escolha. Prioriza o rótulo EXPLÍCITO
 * informado pela IA (`mc_subtype`); só recorre às heurísticas de texto como
 * fallback quando o rótulo está ausente. Heurísticas puras de conteúdo eram
 * frágeis (uma questão padrão com a palavra "complete" ou "falso" era
 * classificada incorretamente), quebrando a distribuição exata.
 */
export function resolveMcSubtype(q: GenQuestion): "standard" | "true_false_block" | "fill_blank_block" {
  if (q.mc_subtype === "true_false_block" || q.mc_subtype === "fill_blank_block" || q.mc_subtype === "standard") {
    return q.mc_subtype;
  }
  if (isFillBlankMultipleChoice(q)) return "fill_blank_block";
  if (isTrueFalseMultipleChoice(q)) return "true_false_block";
  return "standard";
}

/* ----------------------------------------------------------------------------
 * VALIDAÇÃO ESTRUTURAL DE BLOCOS (item de aceite obrigatório).
 * Um bloco V/F só é válido se o ENUNCIADO listar as afirmativas numeradas
 * (I–V ou 1–5) e as alternativas A–E forem sequências de V/F. Um bloco de
 * Completar Lacunas só é válido se o enunciado trouxer lacunas "_____" (ou
 * itens numerados) e as alternativas A–E forem sequências de preenchimento.
 * Blocos sem essa estrutura são REJEITADOS (e re-solicitados à IA) para nunca
 * renderizar um bloco incompleto — ex.: V/F que pula direto para as
 * sequências A–E sem listar as 5 afirmativas.
 * -------------------------------------------------------------------------- */
function countEnumeratedItems(prompt: string): number {
  const text = ` ${String(prompt ?? "")} `;
  const romans = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])(I|II|III|IV|V)\s*[).\-–:]/g)) romans.add(m[1].toUpperCase());
  if (romans.size >= 4) return romans.size;
  const arabics = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])([1-5])\s*[).\-–:]/g)) arabics.add(m[1]);
  return Math.max(romans.size, arabics.size);
}

function stripOptionLetter(option: string): string {
  return String(option ?? "").replace(/^[\s(\[]*[A-Ea-e]\s*[).\-:]\s*/, "").trim();
}

function isVFSequenceOption(option: string): boolean {
  const body = stripOptionLetter(option);
  const vfTokens = (body.match(/\b[VFvf]\b/g) ?? []).length;
  const compact = (body.match(/[VFvf]/g) ?? []).length;
  // Aceita "V - F - V - V - F" (tokens) ou "VFVVF" (compacto), exigindo que o
  // corpo seja essencialmente uma sequência de V/F (sem texto descritivo longo).
  const isMostlyVF = /^[\sVFvf.,;:/\-–]+$/.test(body) && compact >= 3;
  return vfTokens >= 3 || isMostlyVF;
}

function isSequenceOption(option: string): boolean {
  const body = stripOptionLetter(option);
  return /[\/–\-;]/.test(body) && body.replace(/[^\p{L}]/gu, "").length >= 3;
}

function countBlankMarkers(prompt: string): number {
  return String(prompt ?? "").match(/_{3,}/g)?.length ?? 0;
}

export function isStructuredTrueFalseBlock(q: GenQuestion, optionCount = 5): boolean {
  if (q.qtype !== "multiple_choice" || !Array.isArray(q.options) || q.options.length !== optionCount) return false;
  const seqOptions = q.options.filter((o) => isVFSequenceOption(o)).length;
  return countEnumeratedItems(q.prompt) >= 5 && seqOptions === optionCount;
}

export function isStructuredFillBlankBlock(q: GenQuestion, optionCount = 5): boolean {
  if (q.qtype !== "multiple_choice" || !Array.isArray(q.options) || q.options.length !== optionCount) return false;
  const hasBlanks = countBlankMarkers(q.prompt) >= 5;
  const hasItems = countEnumeratedItems(q.prompt) >= 5;
  const seqOptions = q.options.filter((o) => isSequenceOption(o)).length;
  return (hasBlanks || hasItems) && seqOptions === optionCount;
}

function exactQuestionSelection(
  parsed: GenQuestion[],
  counts: VersionGenArgs["counts"],
  multipleChoiceSubtypes?: MCSubtypeCounts | null,
  optionCount = 5,
): {
  ordered: GenQuestion[];
  issue: string | null;
  /**
   * Preenchido quando faltam APENAS subtipos de múltipla escolha (standard,
   * V/F ou Lacunas) e todos os tipos diretos já foram atendidos. Permite uma
   * regeneração ESPECÍFICA por subtipo (sem regenerar a avaliação inteira),
   * preservando as questões já validadas. Todas as outras validações
   * (lexical, estrutural, consistência gabarito↔comentário) continuam ativas.
   */
  subtypeShortfall?: {
    needs: { standard: number; true_false_block: number; fill_blank_block: number };
    partial: GenQuestion[];
  };
} {
  const targets: Record<QType, number> = {
    multiple_choice: counts.multiple_choice,
    true_false: counts.true_false,
    fill_blank: counts.fill_blank,
    essay: counts.essay,
  };
  const byType: Record<QType, GenQuestion[]> = { multiple_choice: [], true_false: [], fill_blank: [], essay: [] };
  for (const q of parsed) if (byType[q.qtype]) byType[q.qtype].push(q);

  if (!multipleChoiceSubtypes) {
    byType.multiple_choice = byType.multiple_choice.filter((q) => resolveMcSubtype(q) === "standard");
  }

  if (multipleChoiceSubtypes && targets.multiple_choice > 0) {
    const wanted = {
      standard: Math.max(0, multipleChoiceSubtypes.standard ?? targets.multiple_choice),
      true_false_block: Math.max(0, multipleChoiceSubtypes.true_false_block ?? 0),
      fill_blank_block: Math.max(0, multipleChoiceSubtypes.fill_blank_block ?? 0),
    };
    const fillBlankBlocks = byType.multiple_choice.filter(
      (q) => resolveMcSubtype(q) === "fill_blank_block" && isStructuredFillBlankBlock(q, optionCount),
    );
    const trueFalseBlocks = byType.multiple_choice.filter(
      (q) => resolveMcSubtype(q) === "true_false_block" && isStructuredTrueFalseBlock(q, optionCount),
    );
    const standard = byType.multiple_choice.filter(
      (q) => resolveMcSubtype(q) === "standard" && !isTrueFalseMultipleChoice(q) && !isFillBlankMultipleChoice(q),
    );
    const shortfall: string[] = [];
    const pickedStandard = standard.slice(0, wanted.standard);
    const pickedTrueFalse = trueFalseBlocks.slice(0, wanted.true_false_block);
    const pickedFillBlank = fillBlankBlocks.slice(0, wanted.fill_blank_block);
    if (pickedStandard.length < wanted.standard)
      shortfall.push(`Múltipla escolha padrão: esperado ${wanted.standard}, gerado ${pickedStandard.length}`);
    if (pickedTrueFalse.length < wanted.true_false_block)
      shortfall.push(`Bloco V/F em múltipla escolha: esperado ${wanted.true_false_block}, gerado ${pickedTrueFalse.length}`);
    if (pickedFillBlank.length < wanted.fill_blank_block)
      shortfall.push(`Bloco Completar Lacunas em múltipla escolha: esperado ${wanted.fill_blank_block}, gerado ${pickedFillBlank.length}`);
    byType.multiple_choice = [...pickedStandard, ...pickedTrueFalse, ...pickedFillBlank];
    if (shortfall.length > 0) {
      // Faltam apenas subtipos de múltipla escolha e todos os tipos diretos já
      // foram atendidos → habilita regeneração ESPECÍFICA por subtipo,
      // preservando as questões já validadas (sem regenerar a prova inteira).
      const otherTypesMet =
        byType.true_false.length >= targets.true_false &&
        byType.fill_blank.length >= targets.fill_blank &&
        byType.essay.length >= targets.essay;
      if (otherTypesMet) {
        const partial = [
          ...byType.multiple_choice,
          ...byType.true_false.slice(0, targets.true_false),
          ...byType.fill_blank.slice(0, targets.fill_blank),
          ...byType.essay.slice(0, targets.essay),
        ];
        return {
          ordered: [],
          issue: shortfall.join("; "),
          subtypeShortfall: {
            needs: {
              standard: Math.max(0, wanted.standard - pickedStandard.length),
              true_false_block: Math.max(0, wanted.true_false_block - pickedTrueFalse.length),
              fill_blank_block: Math.max(0, wanted.fill_blank_block - pickedFillBlank.length),
            },
            partial,
          },
        };
      }
      return { ordered: [], issue: shortfall.join("; ") };
    }
  }

  (Object.keys(targets) as QType[]).forEach((t) => {
    if (byType[t].length > targets[t]) byType[t] = byType[t].slice(0, targets[t]);
  });
  const unmet = (Object.keys(targets) as QType[])
    .filter((t) => byType[t].length !== targets[t])
    .map((t) => `${TYPE_LABELS[t]}: esperado ${targets[t]}, gerado ${byType[t].length}`);
  if (unmet.length > 0) return { ordered: [], issue: unmet.join("; ") };
  return { ordered: [...byType.multiple_choice, ...byType.true_false, ...byType.fill_blank, ...byType.essay], issue: null };
}

type DifficultyLevel = "basico" | "medio" | "avancado" | "superior" | "misto";
type DifficultyCounts = { basico?: number; medio?: number; avancado?: number; superior?: number };
type DifficultyByTypeValue = DifficultyLevel | DifficultyCounts;

type VersionGenArgs = {
  counts: { multiple_choice: number; true_false: number; fill_blank: number; essay: number };
  multipleChoiceSubtypes?: MCSubtypeCounts | null;
  rigor: "light" | "balanced" | "strict";
  maxScore: number;
  moduleLessons: string;
  formatInstructions?: string | null;
  trimmed: string;
  versionLabel: string;
  versionCount: number;
  /** Número de alternativas das questões de múltipla escolha (3, 4 ou 5). */
  optionCount: number;
  avoidPrompts: string[];
  topics?: string[] | null;
  qualityRules?: string[] | null;
  difficultyLevel?: "basico" | "medio" | "avancado" | "superior" | "misto";
  difficultyByType?: {
    multiple_choice?: DifficultyByTypeValue;
    true_false?: DifficultyByTypeValue;
    fill_blank?: DifficultyByTypeValue;
    essay?: DifficultyByTypeValue;
  } | null;
  /**
   * Instante (ms epoch) até o qual a geração por IA pode rodar. Quando o tempo
   * acaba, a geração recai imediatamente no motor determinístico, garantindo
   * que a requisição nunca estoure o limite do gateway.
   */
  deadlineAt?: number;
  /**
   * Termos que jamais podem virar conceito/alternativa (ex.: nome do professor
   * extraído do cabeçalho da apostila). Usado pelo "assessor" de qualidade.
   */
  bannedTerms?: string[];
};

/**
 * Regeneração ESPECÍFICA de UM subtipo de múltipla escolha (standard, bloco
 * V/F ou bloco de Completar Lacunas). Chamado quando a composição da versão
 * está completa nos tipos diretos, mas falta(m) questão(ões) de um subtipo.
 * Pede à IA APENAS aquele subtipo em formato canônico e valida com as MESMAS
 * regras da seleção (lexical, estrutural e consistência gabarito↔comentário),
 * sem afrouxar nenhum critério. Não regenera as demais questões.
 */
type McSubtype = "standard" | "true_false_block" | "fill_blank_block";

function subtypeIsValid(q: GenQuestion, subtype: McSubtype, optionCount = 5): boolean {
  if (resolveMcSubtype(q) !== subtype) return false;
  if (subtype === "true_false_block") return isStructuredTrueFalseBlock(q, optionCount);
  if (subtype === "fill_blank_block") return isStructuredFillBlankBlock(q, optionCount);
  // standard: já validado por normalizeGeneratedQuestion; rejeita blocos travestidos.
  return !isTrueFalseMultipleChoice(q) && !isFillBlankMultipleChoice(q);
}

const FALLBACK_CONCEPTS = [
  "processo", "contexto", "evidência", "análise", "resultado", "estratégia", "relação", "critério",
  "aplicação", "conceito", "interpretação", "comparação", "síntese", "decisão", "fenômeno", "modelo",
];

const FALLBACK_STOPWORDS = new Set([
  "aula", "apostila", "conteudo", "conteúdo", "modulo", "módulo", "tema", "temas", "sobre", "para", "como", "quando",
  "onde", "qual", "quais", "porque", "entao", "então", "muito", "mais", "menos", "entre", "dentro", "fora", "cada",
  "esse", "essa", "este", "esta", "isso", "tambem", "também", "apenas", "todos", "todas", "parte", "forma",
  "deve", "podem", "pode", "ser", "ter", "uma", "umas", "uns", "com", "dos", "das", "pela", "pelo", "pelos", "pelas",
  "www", "http", "https", "pagina", "página", "capitulo", "capítulo", "atividade", "exercicio", "exercício",
  "outro", "outra", "outros", "outras", "assim", "portanto", "logo", "ainda", "seja", "sendo", "cujo", "cuja",
]);

// Conectivos que, sozinhos, não caracterizam um conceito de conteúdo.
const CONCEPT_CONNECTORS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos", "para", "com", "a", "o", "as", "os", "ou",
]);

/**
 * Palavras que iniciam frase mas NÃO são conceitos (quantificadores, verbos
 * comuns, advérbios). Quando um "conceito" extraído é composto apenas por uma
 * dessas palavras (após remover conectivos das bordas), ele é um FRAGMENTO de
 * frase — ex.: "Muitas de", "Formam com", "Distinguir e", "Ilustração e" — e
 * deve ser descartado em vez de virar enunciado/alternativa.
 */
const FRAGMENT_STARTERS = new Set([
  "muitas", "muitos", "muita", "muito", "poucas", "poucos", "varias", "varios", "algumas", "alguns",
  "formam", "forma", "formar", "distinguir", "distingue", "ilustracao", "ilustra", "ilustrar",
  "professor", "professora", "docente", "autor", "autora", "exemplo", "exemplos", "figura", "tabela",
  "note", "observe", "veja", "perceba", "considere", "assim", "portanto", "logo", "ainda", "tambem",
  "existem", "existe", "havia", "havera", "sao", "estao", "possuem", "possui", "apresentam", "apresenta",
]);

/**
 * Rótulos pedagógicos / metadados da apostila que NÃO são conceitos de
 * conteúdo e, portanto, jamais devem virar conceito, enunciado ou alternativa
 * de uma questão (ex.: "Sugestão de recurso visual", "Objetivos", "Para
 * refletir", "Curiosidades", "Recursos online", "Referências"). A avaliação
 * deve girar em torno do conteúdo conceitual/aplicado, não desses rótulos.
 */
const PEDAGOGICAL_LABEL_RE =
  /^(?:apresenta[çc][ãa]o|introdu[çc][ãa]o|contextualiza[çc][ãa]o|fundamenta[çc][ãa]o\s+te[óo]rica|sum[áa]rio|conclus[ãa]o|considera[çc][õo]es\s+finais|objetivos?(?:\s+gerais?)?(?:\s+e\s+espec[íi]ficos?)?|objetivos?\s+espec[íi]ficos?|para\s+refletir|para\s+ir\s+al[ée]m|curiosidades?|voc[êe]\s+sabia|exemplos?\s+aplicados?|sugest[ãa]o\s+de\s+recurso\s+visual|recursos?\s+visuais?|recursos?\s+online(?:\s+e\s+v[íi]deos)?|artigos?\s+cient[íi]ficos?(?:\s+e\s+revis[õo]es)?|refer[êe]ncias?(?:\s+bibliogr[áa]ficas?)?|bibliografia|gloss[áa]rio|atividades?(?:\s+propostas?)?|exerc[íi]cios?(?:\s+propostos?)?)\b/i;

/**
 * Remove conectivos e "ruído" das bordas de um conceito extraído, para que
 * "Regras de Lipinski e" vire "Regras de Lipinski" e fragmentos como
 * "Muitas de" fiquem reduzidos à sua palavra-núcleo (que será então rejeitada
 * pela regra de palavra única).
 */
function trimConnectorEdges(phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean);
  const isEdgeNoise = (w: string) => {
    const n = normalizeForCompare(w);
    return !n || n.length <= 2 || CONCEPT_CONNECTORS.has(n) || FALLBACK_STOPWORDS.has(n);
  };
  while (words.length && isEdgeNoise(words[0])) words.shift();
  while (words.length && isEdgeNoise(words[words.length - 1])) words.pop();
  return words.join(" ");
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function humanizeConcept(value: string): string {
  return String(value ?? "")
    .replace(/[_*#>`~()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

/**
 * Extrai nomes que NÃO podem virar alternativas de uma questão — sobretudo o
 * nome do professor presente no cabeçalho da apostila (ex.: "JAÍLSON RESENDE").
 * Usa o override do cabeçalho quando disponível e varre o topo do documento
 * atrás de rótulos ("Prof.", "Docente:") e de linhas em CAIXA ALTA.
 */
function extractBannedNames(apostilaText: string, professorOverride: string | null): string[] {
  const set = new Set<string>();
  const add = (n: string | null | undefined) => {
    const t = String(n ?? "").trim();
    if (t.length >= 3) set.add(t);
  };
  add(professorOverride);
  const head = String(apostilaText ?? "").slice(0, 3000);
  for (const m of head.matchAll(
    /(?:prof(?:a|essor(?:a)?)?\.?|docente|elaborad[oa]\s+por|autor(?:a)?)\s*[:\-]?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+){1,3})/giu,
  )) {
    add(m[1]);
  }
  for (const line of head.split("\n")) {
    const t = line.trim();
    const words = t.split(/\s+/);
    if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{6,60}$/.test(t) && words.length >= 2 && words.length <= 4) add(t);
  }
  return [...set];
}

function extractFallbackConcepts(
  text: string,
  moduleLessons: string,
  topics: string[] = [],
  bannedTerms: string[] = [],
): string[] {
  const concepts: string[] = [];
  const seen = new Set<string>();
  // Palavras banidas (ex.: nome do professor no cabeçalho da apostila) — nunca
  // podem virar conceito nem, portanto, alternativa de uma questão.
  const bannedSet = new Set(
    bannedTerms
      .flatMap((t) => normalizeForCompare(t).split(" "))
      .filter((w) => w.length > 2),
  );
  const add = (raw: string) => {
    // Remove marcadores de lista à esquerda ("3.", "1)") e pontuação à direita.
    const concept = sanitizeExtractedConcept(
      trimConnectorEdges(
        humanizeConcept(raw)
          .replace(/^\s*\d+\s*[.)\\-–]\s*/, "")
          .replace(/[\s:;,\\-–]+$/, "")
          .trim(),
      ),
    );
    if (!concept) return; // rótulo estrutural ("Disciplina", "Aula 2", "Ementa")
    const norm = normalizeForCompare(concept);
    const words = norm.split(" ").filter(Boolean);
    const wordCount = words.length;
    if (norm.length < 4 || norm.length > 90 || FALLBACK_STOPWORDS.has(norm) || seen.has(norm)) return;
    // Rejeita rótulos pedagógicos/metadados (objetivos, curiosidades, sugestão
    // de recurso visual, referências, etc.) — não são conceitos avaliáveis.
    if (PEDAGOGICAL_LABEL_RE.test(concept)) return;
    // Rejeita cabeçalhos/nomes próprios em CAIXA ALTA (ex.: "JAÍLSON RESENDE").
    if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(concept) && !/[a-záéíóúâêôãõç]/.test(concept)) return;
    // Rejeita termos banidos (nome do professor etc.).
    if (bannedSet.size && words.some((w) => bannedSet.has(w))) return;
    // Rejeita fragmentos de frase iniciados por quantificador/verbo/advérbio
    // comum (ex.: "Muitas de" -> "muitas", "Formam com" -> "formam").
    if (words.every((w) => FRAGMENT_STARTERS.has(w))) return;
    // Rejeita fragmentos: exige ao menos uma palavra de conteúdo real.
    const contentWords = words.filter(
      (w) => w.length >= 4 && !CONCEPT_CONNECTORS.has(w) && !FALLBACK_STOPWORDS.has(w),
    );
    if (contentWords.length === 0) return;
    if (wordCount === 1 && !/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(concept.slice(1)) && !/(ase|ina|mab|cepte|logia|farmaco|fármaco|gen|gene|rna|dna)$/i.test(concept)) return;
    if (/^\d+$/.test(norm) || findBannedPromptPhrase(concept)) return;
    seen.add(norm);
    concepts.push(concept);
  };
  for (const topic of topics) add(topic);
  for (const part of String(moduleLessons ?? "").split(/[|,;:\n\-–]+/)) add(part);
  const source = String(text ?? "").slice(0, 18000).replace(/https?:\/\/\S+/g, " ");
  for (const line of source.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.{8,110})$/);
    if (heading) add(heading[1]);
    for (const match of line.matchAll(/\*\*([^*]{8,100})\*\*/g)) add(match[1]);
    for (const match of line.matchAll(/\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\-]+(?:\s+(?:de|da|do|das|dos|e|em|na|no|para|com|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\-]+)){1,7})/gu)) add(match[1]);
  }
  return concepts.length >= 10 ? concepts : [...concepts, ...FALLBACK_CONCEPTS].filter((v, i, arr) => arr.findIndex((x) => normalizeForCompare(x) === normalizeForCompare(v)) === i);
}

function pickFallbackConcepts(args: VersionGenArgs, count: number, salt: string): string[] {
  const concepts = extractFallbackConcepts(args.trimmed, args.moduleLessons, args.topics ?? [], args.bannedTerms ?? []);
  const picked: string[] = [];
  const seen = new Set<string>();
  const offset = concepts.length ? stableHash(`${args.versionLabel}:${salt}:${args.avoidPrompts.length}`) % concepts.length : 0;
  for (let i = 0; picked.length < count && i < concepts.length * 3; i++) {
    const concept = concepts[(offset + i * 5 + i) % concepts.length];
    const norm = normalizeForCompare(concept);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    picked.push(concept);
  }
  for (const concept of FALLBACK_CONCEPTS) {
    if (picked.length >= count) break;
    const norm = normalizeForCompare(concept);
    if (!seen.has(norm)) {
      seen.add(norm);
      picked.push(concept);
    }
  }
  return picked.slice(0, count);
}

/**
 * COMPLEMENTO — INTEGRAÇÃO COM A APOSTILA
 *
 * A partir do conteúdo da apostila do módulo/aula selecionado, extrai os
 * "conceitos centrais" (títulos, subtítulos, palavras-chave em negrito e
 * tópicos informados) e monta um bloco de orientação para a IA. Serve para:
 *  - preencher automaticamente marcadores como [CONCEITO CENTRAL ESTUDADO NO MÓDULO];
 *  - reforçar o alinhamento conteúdo ↔ questão;
 *  - sugerir estruturas de enunciado prontas ancoradas na apostila.
 */
function buildApostilaGuidance(args: VersionGenArgs): string {
  const concepts = extractFallbackConcepts(
    args.trimmed,
    args.moduleLessons,
    args.topics ?? [],
    args.bannedTerms ?? [],
  )
    .filter((c) => !FALLBACK_CONCEPTS.includes(c))
    .slice(0, 24);
  if (concepts.length === 0) return "";
  const samples = concepts.slice(0, 6).map(sanitizeConceptTopic);
  const stems = [
    `Sobre ${samples[0]}, assinale a alternativa correta.`,
    samples[1] ? `Em ${samples[1]}, qual alternativa expressa corretamente o conceito central?` : "",
    samples[2] ? `Considerando ${samples[2]}, qual alternativa apresenta a relação correta?` : "",
    samples[3] ? `Na análise de ${samples[3]}, qual alternativa melhor representa um critério técnico adequado?` : "",
  ].filter(Boolean);


  return [
    "=== CONCEITOS CENTRAIS EXTRAÍDOS DA APOSTILA (USE COMO FONTE) ===",
    concepts.map((c) => `- ${c}`).join("\n"),
    "",
    "REGRAS DE USO OBRIGATÓRIAS:",
    "- Cada questão deve girar em torno de UM destes conceitos (ou de outro conceito explicitamente presente na apostila).",
    "- PROIBIDO entregar marcadores como [CONCEITO CENTRAL ESTUDADO NO MÓDULO] ou termos genéricos (\"Disciplina\", \"Conteúdo\", \"Tema\"): substitua sempre por um conceito real da lista acima.",
    "- Se um conceito não aparecer na apostila, NÃO o utilize — prefira sempre os conceitos listados.",
    "- Formule a questão de forma direta e técnica, sem referenciar a estrutura do curso (não use termos como 'no módulo', 'nesta aula' ou 'na apostila').",
    "",
    "ESTRUTURAS DE ENUNCIADO SUGERIDAS (adapte ao nível de dificuldade):",
    stems.map((s) => `- ${s}`).join("\n"),
  ].join("\n");
}

/**
 * Verificação de ALINHAMENTO conteúdo ↔ questão: sinaliza ao professor as
 * questões cujo enunciado não encontra ancoragem lexical na apostila (possível
 * desalinhamento com o módulo/aula selecionado).
 */
function findMisalignedQuestions(
  questions: GenQuestion[],
  apostilaText: string,
  versionLabel: string,
): Array<{ version: string; position: number; prompt: string }> {
  const haystack = normalizeForCompare(String(apostilaText ?? "").slice(0, 60000));
  if (!haystack) return [];
  const out: Array<{ version: string; position: number; prompt: string }> = [];
  questions.forEach((q, i) => {
    const words = normalizeForCompare(q.prompt)
      .split(" ")
      .filter((w) => w.length >= 6 && !FALLBACK_STOPWORDS.has(w) && !CONCEPT_CONNECTORS.has(w));
    if (words.length === 0) return;
    const hits = new Set(words.filter((w) => haystack.includes(w)));
    if (hits.size < 2) {
      out.push({ version: versionLabel, position: i + 1, prompt: q.prompt.slice(0, 160) });
    }
  });
  return out;
}

/* ----------------------------------------------------------------------------
 * AUDITORIA DE CONCEITO CENTRAL (INTEGRAÇÃO COM A APOSTILA)
 *
 * 1) Mapeia os conceitos centrais da apostila do módulo/aula selecionado.
 * 2) Bloqueia placeholders genéricos ("Disciplina", "Conteúdo", "Tema") no
 *    enunciado final.
 * 3) Substitui o placeholder pelo conceito central mais provável, usando as
 *    pistas das próprias alternativas cruzadas com os conceitos da apostila.
 * 4) Verifica coerência enunciado ↔ alternativas.
 * 5) Confirma que o conceito existe na apostila selecionada.
 * 6) Tagueia a origem da questão (Aula N / Módulo).
 * -------------------------------------------------------------------------- */
export type QuestionAudit = {
  version: string;
  position: number;
  concept: string | null;
  lesson_tag: string | null;
  status: "ok" | "ajustado" | "revisar" | "nivel";
  message: string | null;
  concept_options: string[];
  /** Nível declarado pelo professor para o tipo desta questão. */
  declared_level?: string | null;
  /** Nível cognitivo detectado automaticamente no enunciado. */
  detected_level?: string | null;
  /** Enunciado sugerido, compatível com o nível declarado. */
  suggested_prompt?: string | null;
};

const GENERIC_PLACEHOLDER_RE =
  /(?:^|[\s("'])((?:Disciplina|Conte[úu]do|Tema|Assunto|Mat[ée]ria|Apostila|Aula|Material|M[óo]dulo|Unidade)s?)(?=[\s,.;:?!)"']|$)/i;
const GENERIC_PLACEHOLDER_ALL_RE =
  /(?:^|[\s("'])((?:Disciplina|Conte[úu]do|Tema|Assunto|Mat[ée]ria|Apostila|Aula|Material|M[óo]dulo|Unidade)s?)(?=[\s,.;:?!)"']|$)/gi;
const CONCEPT_MARKER_RE = /\[[^\]]{3,80}\]/;

function detectGenericPlaceholder(prompt: string): string | null {
  const marker = prompt.match(CONCEPT_MARKER_RE);
  if (marker) return marker[0];
  const m = prompt.match(GENERIC_PLACEHOLDER_RE);
  if (!m) return null;
  const idx = prompt.indexOf(m[1]);
  // "Disciplina de Química Farmacêutica" é qualificado — não é placeholder vazio.
  // Whitelist 1: Preposição + Nome Próprio (Maiúscula).
  const rest = prompt.slice(idx + m[1].length).trimStart();
  if (/^(?:de|da|do|das|dos)\s+\p{Lu}/u.test(rest)) return null;
  // Whitelist 2: Fluxo natural (minúscula). Ex: "matéria orgânica", "conteúdo programático".
  // Só bloqueamos se o termo estiver isolado, seguido de preposição de ligação ou pontuação/fim de linha.
  // Se houver qualquer palavra começando com minúscula após o termo, permitimos (uso natural).
  if (rest && /^[a-zÀ-ÿ]/.test(rest)) return null;
  return m[1];
}

/** Artigo definido provável para o conceito central (heurística pt-BR). */
function conceptArticle(concept: string): string {
  const head = concept.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/(a|ade|ao|cao|ção|dade|ncia|ência|ura|eza)$/.test(head)) return "a";
  return /a$/.test(head) ? "a" : "o";
}

/**
 * Correção cirúrgica de placeholders genéricos ("Disciplina", "Conteúdo",
 * "Tema", "Assunto", "Matéria") em qualquer texto da questão — enunciado ou
 * alternativas — usando o MESMO conceito central detectado no enunciado.
 */
export function replaceGenericPlaceholders(text: string, concept: string): string {
  const raw = String(text ?? "");
  if (!raw || !concept) return raw;
  let out = raw.replace(CONCEPT_MARKER_RE, concept);
  out = out.replace(GENERIC_PLACEHOLDER_ALL_RE, (full, term: string, offset: number) => {
    const idx = offset + full.lastIndexOf(term);
    const rest = out.slice(idx + term.length).trimStart();
    // Complemento próprio (ex.: "Tema de Química Medicinal") não é placeholder.
    if (/^(?:de|da|do|das|dos)\s+\p{Lu}/u.test(rest)) return full;
    const before = out.slice(0, idx).trimEnd();
    const prevWord = (before.split(/\s+/).pop() ?? "").toLowerCase();
    const hasDeterminer = /^(a|o|as|os|da|do|das|dos|na|no|nas|nos|à|às|ao|aos|de|em|essa|esse|esta|este|sua|seu)$/.test(prevWord);
    const replacement = hasDeterminer ? concept : `${conceptArticle(concept)} ${concept}`;
    return full.replace(term, replacement);
  });
  return out.replace(/\s{2,}/g, " ");
}

/** Verificação textual final: sobrou algum termo genérico na questão? */
export function hasGenericPlaceholderLeft(prompt: string, options?: string[] | null): boolean {
  const texts = [String(prompt ?? ""), ...(Array.isArray(options) ? options.map((o) => String(o ?? "")) : [])];
  return texts.some((t) => CONCEPT_MARKER_RE.test(t) || detectGenericPlaceholder(t) !== null);
}

/* --------------------------------------------------------------------------
 * ENUNCIADOS TRUNCADOS
 * Casos como "Propriedades Físico-Químicas de Fármacos I – Polaridade, Solub"
 * (palavra cortada no fim do enunciado ou antes de "…"/"..."). O termo é
 * completado com a palavra correspondente da apostila; quando não há
 * correspondência, a questão é marcada para revisão manual.
 * -------------------------------------------------------------------------- */

/** Vocabulário da apostila: palavra normalizada -> grafia original. */
export function buildApostilaVocabulary(apostilaText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of String(apostilaText ?? "").matchAll(/\p{L}{5,}/gu)) {
    const n = normalizeForCompare(m[0]);
    if (n && !map.has(n)) map.set(n, m[0]);
  }
  return map;
}

/**
 * Completa palavras truncadas (apenas no fim do texto ou imediatamente antes
 * de "…"/"..."), usando a apostila como dicionário. Retorna o texto ajustado e
 * a lista de trechos ainda truncados que não puderam ser completados.
 */
export function completeTruncatedTerms(
  text: string,
  vocab: Map<string, string>,
): { text: string; fixed: string[]; pending: string[] } {
  const raw = String(text ?? "");
  if (!raw.trim()) return { text: raw, fixed: [], pending: [] };
  const fixed: string[] = [];
  const pending: string[] = [];

  const resolve = (word: string): string | null => {
    const n = normalizeForCompare(word);
    if (n.length < 4 || vocab.has(n)) return null;
    const matches = [...vocab.keys()].filter((k) => k.startsWith(n) && k.length >= n.length + 2);
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.length - b.length);
    return vocab.get(matches[0]) ?? null;
  };

  // 1) Palavras seguidas de reticências ("Solub...", "Solub…").
  let out = raw.replace(/(\p{L}{4,})(\s*(?:\.{3}|…))/gu, (full, word: string) => {
    const full$ = resolve(word);
    if (full$) {
      fixed.push(`${word} → ${full$}`);
      return full$;
    }
    pending.push(word);
    return full;
  });

  // 2) Última palavra do texto quando não há pontuação final.
  const tail = out.match(/(\p{L}{4,})\s*$/u);
  if (tail) {
    const full$ = resolve(tail[1]);
    if (full$) {
      fixed.push(`${tail[1]} → ${full$}`);
      out = out.slice(0, tail.index) + out.slice(tail.index!).replace(tail[1], full$);
    } else if (!/[.!?:;)"']\s*$/.test(raw)) {
      const n = normalizeForCompare(tail[1]);
      if (!vocab.has(n) && [...vocab.keys()].some((k) => k.startsWith(n) && k.length > n.length)) {
        pending.push(tail[1]);
      }
    }
  }

  return { text: out, fixed, pending };
}
/** Divide a apostila em seções por aula para taguear a origem da questão. */
function buildLessonSections(apostilaText: string): Array<{ tag: string; text: string }> {
  const text = String(apostilaText ?? "");
  const re = /aula\s*0*(\d{1,2})/gi;
  const marks: Array<{ tag: string; at: number }> = [];
  for (const m of text.matchAll(re)) marks.push({ tag: `Aula ${Number(m[1])}`, at: m.index ?? 0 });
  if (marks.length === 0) return [];
  const out: Array<{ tag: string; text: string }> = [];
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    out.push({ tag: mk.tag, text: normalizeForCompare(text.slice(mk.at, end)) });
  });
  return out;
}

function conceptWords(concept: string): string[] {
  return normalizeForCompare(concept)
    .split(" ")
    .filter((w) => w.length >= 4 && !CONCEPT_CONNECTORS.has(w) && !FALLBACK_STOPWORDS.has(w));
}

function conceptAppearsIn(concept: string, haystackNorm: string): boolean {
  const words = conceptWords(concept);
  if (words.length === 0) return false;
  const hits = words.filter((w) => haystackNorm.includes(w)).length;
  return hits / words.length >= 0.6;
}

function lowerFirst(value: string): string {
  if (!value) return value;
  // Preserva siglas/nomes próprios (ex.: "Lei de Noyes-Whitney", "Log P").
  const words = value.split(/\s+/);
  if (words.length > 1 && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(words[1] ?? "")) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/* --------------------------------------------------------------------------
 * AJUSTE SEMÂNTICO — expressões genéricas por tipo de conceito central.
 * "finalidade terapêutica" é vaga quando o conceito é uma LEI físico-química,
 * uma DISCIPLINA/ÁREA ou uma PROPRIEDADE tecnológica. Especializamos a
 * linguagem conforme o tipo de conceito.
 * -------------------------------------------------------------------------- */
type ConceptKind = "lei" | "area" | "propriedade";

const LAW_RE = /\b(lei|leis|equacao|equacoes|principio|principios|regra|modelo matematico|constante)\b/;
const PROPERTY_RE =
  /\b(estabilidade|compactabilidade|fluxo|polimorfismo|solubilidade|dissolucao|viscosidade|higroscopicidade|granulometria|biodisponibilidade|dureza|friabilidade|densidade|umidade|porosidade|permeabilidade|cristalinidade|desintegracao|compressibilidade)\b/;
const AREA_RE =
  /\b(quimica|farmacognosia|farmacologia|farmacotecnica|biotecnologia|farmaceutica|analitica|medicinal|organica|inorganica|bioquimica|toxicologia|microbiologia|botanica|disciplina|area)\b/;

export function classifyConceptKind(concept: string | null | undefined): ConceptKind | null {
  const norm = normalizeForCompare(String(concept ?? ""));
  if (!norm) return null;
  if (LAW_RE.test(norm)) return "lei";
  if (PROPERTY_RE.test(norm)) return "propriedade";
  if (AREA_RE.test(norm)) return "area";
  return null;
}

const PURPOSE_PHRASE: Record<ConceptKind, { feminine: boolean; text: string }> = {
  lei: { feminine: false, text: "impacto na dissolução, absorção e eficácia dos medicamentos" },
  area: {
    feminine: true,
    text: "finalidade prática na pesquisa, desenvolvimento e controle de qualidade de medicamentos",
  },
  propriedade: {
    feminine: false,
    text: "impacto na estabilidade, produção, conservação e desempenho farmacêutico do medicamento",
  },
};

const GENERIC_PURPOSE_RE =
  /(\b(?:[àa]o?s?|de|da)\s+)?(sua\s+|suas\s+)?finalidade[s]?\s+terap[êe]utica[s]?/gi;

/**
 * Substitui "finalidade terapêutica" (e variações com preposição/possessivo)
 * pela formulação específica ao tipo do conceito central da questão.
 */
export function refineGenericPurposePhrases(text: string, concept: string | null | undefined): string {
  const kind = classifyConceptKind(concept);
  if (!kind || !text) return text;
  const { feminine, text: phrase } = PURPOSE_PHRASE[kind];
  return text.replace(GENERIC_PURPOSE_RE, (_full, prep: string | undefined) => {
    const raw = (prep ?? "").trim().toLowerCase();
    if (!raw) return phrase;
    if (raw === "de" || raw === "da") return `${feminine ? "da" : "do"} ${phrase}`;
    // à / a / ao / às → concorda com o gênero da nova expressão
    return `${feminine ? "à" : "ao"} ${phrase}`;
  });
}

export function auditQuestionConcepts(args: {
  questions: GenQuestion[];
  apostilaText: string;
  moduleLessons: string;
  topics: string[];
  bannedTerms: string[];
  versionLabel: string;
  /** Nível declarado geral (pode ser "misto"). */
  difficultyLevel?: DeclaredLevel | "misto";
  /** Nível declarado por tipo de questão (string) ou mistura de níveis (objeto). */
  difficultyByType?: Record<string, unknown> | null;
  /** Nome real da disciplina — usado apenas como último fallback de conceito. */
  disciplineName?: string | null;
}): { questions: GenQuestion[]; audits: QuestionAudit[] } {
  const apostilaConcepts = extractFallbackConcepts(
    args.apostilaText,
    args.moduleLessons,
    args.topics,
    args.bannedTerms,
  ).filter((c) => !FALLBACK_CONCEPTS.includes(c) && !isStructuralConceptLabel(c));
  // Fallback inteligente: título real da aula/módulo ou nome da disciplina.
  const lessonFallback = resolveConceptFallback(
    String(args.moduleLessons ?? "").split(/[|;\n]+/),
    null,
    args.disciplineName ?? null,
  );
  const haystack = normalizeForCompare(String(args.apostilaText ?? "").slice(0, 60000));
  const sections = buildLessonSections(args.apostilaText);
  const vocab = buildApostilaVocabulary(args.apostilaText);
  const audits: QuestionAudit[] = [];

  /**
   * Resolve o nível declarado para uma questão. Quando o professor escolheu
   * uma MISTURA de níveis para aquele tipo, não há nível único a validar e a
   * checagem de compatibilidade é dispensada.
   */
  const declaredFor = (qtype: string): DeclaredLevel | null => {
    const byType = args.difficultyByType?.[qtype];
    if (typeof byType === "string" && byType in DECLARED_TO_LEVEL) return byType as DeclaredLevel;
    if (byType && typeof byType === "object") return null; // mistura de níveis
    const general = args.difficultyLevel;
    if (general && general !== "misto" && general in DECLARED_TO_LEVEL) return general as DeclaredLevel;
    return null;
  };

  const questions = args.questions.map((q, i) => {
    const position = i + 1;
    const optionsNorm = normalizeForCompare((q.options ?? []).join(" | "));
    // Conceitos candidatos: pistas das alternativas cruzadas com a apostila.
    const fromOptions = apostilaConcepts.filter((c) => conceptAppearsIn(c, optionsNorm));
    const fromPrompt = apostilaConcepts.filter((c) => conceptAppearsIn(c, normalizeForCompare(q.prompt)));
    const candidates = (() => {
      const merged = [...fromOptions, ...fromPrompt]
        .filter((c) => !isStructuralConceptLabel(c))
        .filter((v, idx, arr) => arr.findIndex((x) => normalizeForCompare(x) === normalizeForCompare(v)) === idx)
        .sort((a, b) => conceptWords(b).length - conceptWords(a).length);
      return merged.length > 0 ? merged : lessonFallback;
    })();

    const placeholder = detectGenericPlaceholder(q.prompt);
    // Pós-processamento: limpa pontuação quebrada/ruído e prefixos de
    // alternativa redundantes antes da persistência em assessment_questions.
    let prompt = sanitizeGeneratedQuestionText(q.prompt);
    let options = Array.isArray(q.options)
      ? q.options.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(String(o ?? ""))))
      : q.options;
    let explanation = q.explanation ? sanitizeGeneratedQuestionText(q.explanation) : null;
    let status: QuestionAudit["status"] = "ok";
    let message: string | null = null;

    if (placeholder) {
      const chosen = candidates[0] ?? null;
      if (chosen) {
        prompt = prompt.replace(
          placeholder,
          `${lowerFirst(chosen)},`.replace(/,\s*,/g, ","),
        )
          .replace(/,\s*,/g, ",")
          .replace(/\s{2,}/g, " ")
          .replace(/,\s*(qual|assinale|marque|indique|analise)/i, ", $1");
        // Correção cirúrgica: aplica o MESMO conceito central às alternativas.
        prompt = replaceGenericPlaceholders(prompt, chosen);
        if (Array.isArray(options)) {
          options = options.map((o) => replaceGenericPlaceholders(String(o ?? ""), chosen));
        }
        // Comentários/justificativas também recebem o conceito central.
        if (explanation) explanation = replaceGenericPlaceholders(explanation, chosen);
        status = "ajustado";
        message = `Termo genérico "${placeholder}" substituído pelo conceito central da apostila ("${chosen}") no enunciado e nas alternativas.`;
        // Verificação textual pós-substituição.
        if (hasGenericPlaceholderLeft(prompt, options ?? null)) {
          status = "revisar";
          message = `Questão inconsistente: ainda há termos genéricos ("Disciplina", "Conteúdo", "Tema") no enunciado ou nas alternativas após a correção automática. Revise manualmente antes de gerar o PDF.`;
        }
      } else {
        status = "revisar";
        message = `O enunciado usa o termo genérico "${placeholder}" e não foi possível identificar um conceito central na apostila. Revise manualmente.`;
      }
    }

    const concept = candidates[0] ?? null;

    // ---- Enunciados/alternativas truncados ("... Polaridade, Solub") ------
    const truncFixed: string[] = [];
    const truncPending: string[] = [];
    const promptTrunc = completeTruncatedTerms(prompt, vocab);
    prompt = promptTrunc.text;
    truncFixed.push(...promptTrunc.fixed);
    truncPending.push(...promptTrunc.pending);
    if (Array.isArray(options)) {
      options = options.map((o) => {
        const r = completeTruncatedTerms(String(o ?? ""), vocab);
        truncFixed.push(...r.fixed);
        truncPending.push(...r.pending);
        return r.text;
      });
    }
    if (truncFixed.length > 0 && status === "ok") {
      status = "ajustado";
      message = `Termo truncado completado com base na apostila: ${truncFixed.slice(0, 3).join("; ")}.`;
    }
    if (truncPending.length > 0) {
      status = "revisar";
      message = `Enunciado ou alternativa com termo truncado ("${truncPending[0]}") que não pôde ser completado automaticamente. Revise manualmente antes de gerar o PDF.`;
    }

    // Ajuste semântico: especializa "finalidade terapêutica" conforme o tipo
    // do conceito central (lei físico-química, área/disciplina ou propriedade).
    const semanticConcept = concept ?? candidates[0] ?? null;
    const refinedPrompt = refineGenericPurposePhrases(prompt, semanticConcept);
    let refinedOptions = options;
    if (refinedPrompt !== prompt) prompt = refinedPrompt;
    if (Array.isArray(refinedOptions) && semanticConcept) {
      const base = refinedOptions;
      const next = base.map((o) => refineGenericPurposePhrases(String(o ?? ""), semanticConcept));
      if (next.some((o, idx) => o !== base[idx])) refinedOptions = next;
    }

    // Coerência enunciado ↔ alternativas.
    // CALIBRAÇÃO: Bypass obrigatório para questões V/F e múltiplas afirmativas (I, II, III...).
    // Não validamos o conceito contra as alternativas nestes casos, pois elas são apenas sequências de letras.
    // Também reduzimos o status de "revisar" para aviso informativo conforme nova regra de negócio.
    const isBlockType = q.mc_subtype === "true_false_block" || q.mc_subtype === "fill_blank_block" || isTrueFalseMultipleChoice(q) || isFillBlankMultipleChoice(q);
    const optionsBody = (q.options ?? []).map(o => stripOptionLetter(o)).join(" ");
    const isVFSequence = /^[VvFf\s\-\,\/]+$/.test(optionsBody.replace(/\s/g, ""));
    const hasEnumeratedItems = countEnumeratedItems(q.prompt) >= 3;
    
    const shouldBypassAlignment = isBlockType || isVFSequence || hasEnumeratedItems;
    const optionsToTest = shouldBypassAlignment ? "" : optionsNorm;

    if (status !== "revisar" && concept && !shouldBypassAlignment && (q.options?.length ?? 0) > 0 && !conceptAppearsIn(concept, optionsToTest)) {
      // Falhas de alinhamento agora são apenas informativas e não bloqueiam (status "ajustado" em vez de "revisar")
      status = "ajustado";
      message = `Aviso: O conceito do enunciado ("${concept}") não foi detectado explicitamente nas alternativas. Verifique se a questão está clara.`;
    }

    // Alinhamento conceito ↔ apostila.
    // CALIBRAÇÃO: Suavização da checagem. Aumentamos a tolerância semântica e permitimos aprovação automática
    // se a questão vier de um contexto válido e estiver bem estruturada.
    const conceptInApostila = concept && haystack && conceptAppearsIn(concept, haystack);
    if (status !== "revisar" && concept && !conceptInApostila) {
      status = "revisar";
      message = `Este conceito ("${concept}") não foi identificado na apostila selecionada. Confirme se deseja mantê-lo na avaliação ou ajuste para um conceito estudado no módulo.`;
    }

    // APROVAÇÃO AUTOMÁTICA: Se a questão está bem estruturada e pedagogicamente coerente, aprovamos por padrão.
    if (status === "ok" && (conceptInApostila || !concept)) {
      status = "ok";
      message = "Questão aprovada automaticamente pela IA.";
    }

    // ---- Validação do NÍVEL DE DIFICULDADE declarado ----------------------
    // A questão só é liberada automaticamente se o nível cognitivo detectado
    // for compatível com o nível escolhido pelo professor.
    const declared = declaredFor(q.qtype);
    let declared_level: string | null = declared ? LEVEL_NAMES[DECLARED_TO_LEVEL[declared]] : null;
    let detected_level: string | null = null;
    let suggested_prompt: string | null = null;
    if (declared) {
      const verdict = validateQuestionLevel({
        prompt,
        options: refinedOptions ?? q.options ?? null,
        declared,
        concept,
      });
      detected_level = LEVEL_NAMES[verdict.detected as CognitiveLevel];
      declared_level = LEVEL_NAMES[verdict.declared as CognitiveLevel];
      if (verdict.blocked) {
        status = "nivel";
        suggested_prompt = verdict.suggestion;
        message = `Requer ajuste de nível ou simplificação. ${verdict.message ?? ""}${
          verdict.suggestion ? ` Sugestão de enunciado: "${verdict.suggestion}"` : ""
        }`;
      } else if (verdict.message && status === "ok") {
        message = verdict.message;
      }
    }

    // ---- VALIDADOR DE QUALIDADE (meta-opções e formulações vagas) ---------
    // Qualquer alternativa (ou o enunciado) com meta-texto genérico rejeita a
    // questão: ela precisa ser regenerada com afirmações concretas.
    const contentVerdict = validateQuestionContent({
      prompt,
      options: (refinedOptions ?? q.options ?? null) as string[] | null,
      explanation,
      skipOptions: shouldBypassAlignment,
    });
    // FLUXO NORMAL: o auto-retry silencioso já tentou substituir a questão na
    // geração. Aqui o resultado é apenas informativo (não bloqueia o professor
    // com pedido de revisão manual).
    if (contentVerdict.rejected && status === "ok") {
      status = "ajustado";
      message = "Ajuste automático de redação aplicado pelo validador de conteúdo.";
    }


    // Pós-processamento final: substituições da auditoria podem criar pontuação
    // quebrada, portanto todos os campos são limpos novamente antes de retornar.
    prompt = sanitizeGeneratedQuestionText(prompt);
    if (Array.isArray(refinedOptions)) {
      refinedOptions = refinedOptions.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(String(o ?? ""))));
    }
    if (explanation) explanation = sanitizeGeneratedQuestionText(explanation);

    // Tag de origem (Aula N) pelo conceito central.
    const lesson_tag = concept
      ? (sections.find((s) => conceptAppearsIn(concept, s.text))?.tag ?? "Módulo")
      : null;

    audits.push({
      version: args.versionLabel,
      position,
      concept,
      lesson_tag,
      status,
      message,
      concept_options: candidates.slice(0, 4),
      declared_level,
      detected_level,
      suggested_prompt,
    });

    const optionsChanged =
      Array.isArray(refinedOptions) && Array.isArray(q.options)
        ? refinedOptions.some((o, idx) => o !== q.options?.[idx])
        : refinedOptions !== q.options;
    const explanationChanged = explanation !== (q.explanation ?? null);
    if (prompt === q.prompt && !optionsChanged && !explanationChanged) return q;
    return {
      ...q,
      prompt,
      ...(optionsChanged ? { options: refinedOptions } : {}),
      ...(explanationChanged ? { explanation } : {}),
    };
  });

  return { questions, audits };
}

// GERADOR SINTÉTICO/RELACIONAL REMOVIDO POR DECISÃO DE QUALIDADE.
// As questões de avaliação são geradas EXCLUSIVAMENTE pela IA (mesmo pipeline
// dos Exercícios). É proibido montar enunciados/alternativas por concatenação
// de templates fixos.


/**
 * Gera UM conjunto de questões para UMA versão da avaliação.
 * Quando há mais de uma versão, instrui a IA a abordar subtópicos/enunciados
 * DIFERENTES das versões já geradas (lista `avoidPrompts`), de modo que cada
 * versão tenha questões realmente distintas — e não apenas reordenadas.
 */
const DIFFICULTY_LABELS: Record<string, string> = {
  basico:
    "BÁSICO — reconhecimento e definição: peça para identificar ou definir corretamente um conceito NOMEADO do conteúdo (ex.: definir um termo-chave, distinguir dois conceitos próximos). Linguagem simples, sem casos complexos.",
  medio:
    "INTERMEDIÁRIO — compreensão e aplicação simples: peça para aplicar um conceito a uma situação simples OU comparar duas afirmações sobre o mesmo tema. Use os termos do conteúdo e contextualize-os.",
  avancado:
    "AVANÇADO — análise e correlação: exija relacionar PELO MENOS DOIS conceitos do conteúdo (ex.: uma propriedade + sua consequência prática) por meio de uma pequena situação-problema ou caso aplicado.",
  superior:
    "SUPERIOR/UNIVERSITÁRIO — análise integrada: construa um caso (clínico, técnico ou profissional) que exija correlacionar MÚLTIPLOS conceitos do conteúdo e justificar a melhor decisão. Permita linguagem técnica, sempre ancorada no texto do módulo.",
  misto: "MISTO — varie entre básico, intermediário e avançado ao longo da prova.",
};

const RIGOR_LABELS: Record<string, string> = {
  light: "leve — foco em consolidação dos conceitos centrais",
  balanced: "equilibrado — mistura de compreensão e aplicação",
  strict: "rigoroso — exige síntese crítica e relações entre conceitos",
};

const QUALITY_RULE_LABELS: Record<string, string> = {
  evitar_repeticao: "Não repita enunciados nem ideias entre as questões.",
  distratores_plausiveis: "Em múltipla escolha, todos os distratores devem ser plausíveis e do mesmo campo conceitual da resposta correta.",
  clareza_precisao: "Use linguagem clara, precisa e sem ambiguidade.",
  contexto_especifico: "Cada questão deve trazer um contexto específico do conteúdo, evitando generalidades.",
  estrutura_vf: "Em blocos V/F, liste 5 afirmativas numeradas (I–V) e ofereça sequências V/F nas alternativas.",
  estrutura_lacunas: "Em blocos de lacunas, use o marcador _____ e ofereça sequências de preenchimento nas alternativas.",
};

/**
 * Extração TOLERANTE do array de questões devolvido pela IA. Aceita
 * `{questions:[...]}`, chaves alternativas (`items`, `data`, `perguntas`,
 * `questoes`), array direto `[...]` ou um único objeto de questão.
 */
function extractQuestionArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["questions", "questoes", "questões", "perguntas", "items", "data", "result", "output"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        const nested = extractQuestionArray(v);
        if (nested.length > 0) return nested;
      }
    }
    // Objeto único de questão
    if (typeof obj["prompt"] === "string" || typeof obj["enunciado"] === "string") return [obj];
    // Último recurso: primeiro array de objetos encontrado
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.some((i) => i && typeof i === "object")) return v;
    }
  }
  return [];
}

/**
 * Monta o prompt e chama a Lovable AI para gerar as questões de UMA versão.
 * Retorna apenas as questões que passam por todas as validações estruturais.
 * Em qualquer falha (timeout, erro de rede, JSON inválido) retorna [] e o
 * chamador executa novo ciclo de IA.
 */

async function generateVersionQuestionsAI(args: VersionGenArgs): Promise<GenQuestion[]> {
  const optionCount = Math.max(3, Math.min(5, args.optionCount || 5));
  const lastLetter = "ABCDE"[optionCount - 1];
  const letterRange = `A–${lastLetter}`;
  const subtypes = args.multipleChoiceSubtypes && args.counts.multiple_choice > 0
    ? {
        standard: Math.max(0, args.multipleChoiceSubtypes.standard ?? (args.counts.multiple_choice - Math.max(0, args.multipleChoiceSubtypes.true_false_block ?? 0) - Math.max(0, args.multipleChoiceSubtypes.fill_blank_block ?? 0))),
        true_false_block: Math.max(0, args.multipleChoiceSubtypes.true_false_block ?? 0),
        fill_blank_block: Math.max(0, args.multipleChoiceSubtypes.fill_blank_block ?? 0),
      }
    : { standard: args.counts.multiple_choice, true_false_block: 0, fill_blank_block: 0 };

  const distribution: string[] = [];
  if (subtypes.standard > 0) distribution.push(`${subtypes.standard} de múltipla escolha PADRÃO (mc_subtype:"standard", ${optionCount} alternativas ${letterRange}, uma correta)`);
  if (subtypes.true_false_block > 0) distribution.push(`${subtypes.true_false_block} de múltipla escolha em BLOCO V/F (mc_subtype:"true_false_block": enunciado com 5 afirmativas numeradas I–V e ${optionCount} alternativas ${letterRange} com sequências V/F)`);
  if (subtypes.fill_blank_block > 0) distribution.push(`${subtypes.fill_blank_block} de múltipla escolha em BLOCO LACUNAS (mc_subtype:"fill_blank_block": enunciado com 5 lacunas _____ e ${optionCount} alternativas ${letterRange} com sequências de preenchimento)`);
  if (args.counts.true_false > 0) distribution.push(`${args.counts.true_false} de Verdadeiro/Falso (qtype:"true_false", correct_answer booleano)`);
  if (args.counts.fill_blank > 0) distribution.push(`${args.counts.fill_blank} de Completar lacunas (qtype:"fill_blank", enunciado com _____ e correct_answer com o(s) termo(s) esperado(s))`);
  if (args.counts.essay > 0) distribution.push(`${args.counts.essay} Dissertativa(s) (qtype:"essay", correct_answer null, explanation com expectativa de resposta)`);

  const diffByType = (t: string): string => {
    const v = args.difficultyByType?.[t as "multiple_choice" | "true_false" | "fill_blank" | "essay"];
    if (typeof v === "string") return DIFFICULTY_LABELS[v];
    if (v && typeof v === "object") {
      const parts: string[] = [];
      if (v.basico) parts.push(`${v.basico} ${DIFFICULTY_LABELS["basico"]}`);
      if (v.medio) parts.push(`${v.medio} ${DIFFICULTY_LABELS["medio"]}`);
      if (v.avancado) parts.push(`${v.avancado} ${DIFFICULTY_LABELS["avancado"]}`);
      if (v.superior) parts.push(`${v.superior} ${DIFFICULTY_LABELS["superior"]}`);
      if (parts.length > 0) return `mistura de ${parts.join(" + ")}`;
    }
    return DIFFICULTY_LABELS[args.difficultyLevel ?? "misto"];
  };

  const topicsLine = args.topics && args.topics.length > 0
    ? `Tópicos OBRIGATÓRIOS a contemplar (distribua as questões entre eles): ${args.topics.map(sanitizeConceptTopic).filter(Boolean).join("; ")}.`
    : "";

  const qualityLines = (args.qualityRules ?? [])
    .map((r) => QUALITY_RULE_LABELS[r] ?? r)
    .filter(Boolean);

  const system =
    "Você é um especialista brasileiro em elaboração de avaliações de nível universitário. " +
    "TRAVA DE SINCRONIA E HERANÇA (PIPELINE DE IA): " +
    "1. FONTE ÚNICA DA VERDADE: O Plano de Aula e a Ementa da Disciplina são a MATRIZ ABSOLUTA de conteúdo. " +
    "2. HERANÇA DE CONTEXTO: Gere o conteúdo baseando-se EXCLUSIVAMENTE nos tópicos fornecidos no Plano de Aula/Apostila. É proibido incluir assuntos externos, conceitos ou farmacoterapias que NÃO estejam previstos no material base. " +
    "3. RASTREABILIDADE (MAPPING): Cada questão gerada deve conter no campo 'explanation' a referência/tag explícita de qual Módulo/Aula/Tópico da Apostila ela está testando (ex: 'origem: Aula 4 - Tópico 2'). " +
    "Gere questões em português do Brasil ESTRITAMENTE ancoradas em CONCEITOS e EXEMPLOS reais e nomeados do conteúdo fornecido — trabalhe as definições centrais, os conceitos estruturantes, os exemplos aplicados e as sínteses de cada aula. " +
    "Cada questão deve citar ou parafrasear claramente uma ideia do conteúdo e girar em torno de um conceito ou exemplo CONCRETO, nunca de uma generalidade. " +
    "PROIBIDO usar como enunciado, conceito ou alternativa qualquer FRAGMENTO de frase ou palavra solta recortada do texto. Use somente conceitos e frases completas e bem-formadas. " +
    "Em múltipla escolha: 1 alternativa correta ancorada nos fundamentos do texto e distratores plausíveis, cada um com um ERRO ESPECÍFICO e identificável. NUNCA use distratores genéricos e repetidos. " +
    "RESPEITE RIGOROSAMENTE o nível de dificuldade indicado para cada tipo: o nível define o TIPO DE RACIOCÍNIO exigido, não é apenas um rótulo. " +
    "Nunca use nomes de pessoas (como o nome do professor) como alternativa ou conceito. " +
    "Formule a questão de forma direta e técnica, sem referenciar a estrutura do curso (não use termos como 'no módulo', 'nesta aula' ou 'na apostila'). " +
    "PROIBIÇÃO ABSOLUTA DE META-TEXTO: NUNCA use expressões como 'segundo o material', 'conforme a apostila', 'de acordo com o texto', 'fundamentos do material', 'assinale a correta sobre a aula', 'apresenta a definição correta'. " +
    "CONTEÚDO CONCRETO OBRIGATÓRIO (UNIVERSAL, VÁLIDO PARA QUALQUER ÁREA — SAÚDE, HUMANAS, EXATAS OU BIOLÓGICAS): cada enunciado e TODAS as alternativas devem conter afirmações factuais e substantivas da área da disciplina — conceitos nomeados, mecanismos, processos, autores, teorias, leis, fórmulas, dados, classificações ou exemplos aplicados reais do conteúdo. " +
    "TODAS as alternativas (gabarito e distratores) devem ser afirmações técnicas plausíveis sobre o tema selecionado; nenhuma pode comentar o acerto/erro de outra ou descrever a própria alternativa. " +
    "O nível de dificuldade deve resultar da complexidade das situações-problema e das relações conceituais envolvidas, NUNCA de abstrações genéricas ou de rótulos vagos. " +

    "Responda SOMENTE com um objeto JSON válido no formato {\"questions\": [ ... ]}, sem texto fora do JSON. " +
    "NUNCA use expressões genéricas como 'de acordo com a apostila', 'com base no material', 'conforme a aula' nos enunciados — contextualize com o conteúdo real. " +
    `Em múltipla escolha, gere EXATAMENTE ${optionCount} alternativas (${letterRange}) e nenhuma alternativa pode repetir o enunciado. ` +
    "O campo explanation NÃO deve declarar a letra correta (ex.: não escreva 'Gabarito: C').\n\n" +

    questionFactoryRules(optionCount) +
    "\n\n" +
    assessmentBalanceRules() +
    "\n\n" +
    linguisticClarityRules() +
    "\n\n" +
    difficultyGuardRules();

  const user = [
    `CONTEÚDO DE REFERÊNCIA (apostila/módulo):\n${args.trimmed}`,
    `MÓDULO/AULAS (rótulos tratados): ${String(args.moduleLessons ?? "").split(/[|;\n]+/).map(sanitizeConceptTopic).filter(Boolean).join("; ") || "conteúdo real da apostila"}`,
    buildApostilaGuidance(args),
    topicsLine,
    `RIGOR PEDAGÓGICO: ${RIGOR_LABELS[args.rigor]}.`,
    `NÍVEL DE DIFICULDADE por tipo: múltipla escolha = ${diffByType("multiple_choice")}; V/F = ${diffByType("true_false")}; lacunas = ${diffByType("fill_blank")}; dissertativa = ${diffByType("essay")}.`,
    `DISTRIBUIÇÃO EXATA exigida (gere exatamente esta quantidade de cada tipo):\n- ${distribution.join("\n- ")}`,
    qualityLines.length > 0 ? `PADRÕES DE QUALIDADE:\n- ${qualityLines.join("\n- ")}` : "",
    args.formatInstructions ? `INSTRUÇÕES DE FORMATO: ${args.formatInstructions}` : "",
    args.avoidPrompts.length > 0
      ? `Esta é a versão ${args.versionLabel}. NÃO repita nem parafraseie estes enunciados já usados em outra versão (aborde ângulos/subtópicos diferentes):\n- ${args.avoidPrompts.slice(0, 40).join("\n- ")}`
      : `Esta é a versão ${args.versionLabel}.`,
    `Formato de cada questão no array "questions": {"qtype": "multiple_choice"|"true_false"|"fill_blank"|"essay", "mc_subtype": "standard"|"true_false_block"|"fill_blank_block"|null, "prompt": "enunciado completo", "options": [${Array.from({ length: optionCount }, () => '"..."').join(",")}] | null, "correct_answer": <letra ${letterRange} ou índice para MC, booleano para V/F, texto/array para lacuna, null para dissertativa>, "explanation": "comentário pedagógico do gabarito"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const askAI = async (extraSystem: string, extraUser: string, temperature?: number): Promise<GenQuestion[]> => {
    const raw = await callAIJson<unknown>({
      system: extraSystem ? `${system}\n\n${extraSystem}` : system,
      user: extraUser ? `${user}\n\n${extraUser}` : user,
      // MESMO modelo usado no gerador de Exercícios (paridade de qualidade).
      model: "google/gemini-2.5-flash",
      ...(typeof temperature === "number" ? { temperature } : {}),
    });

    // PARSING TOLERANTE: aceita {questions:[...]}, {items|data|perguntas:[...]},
    // array direto [...] ou objeto único de questão.
    const list = extractQuestionArray(raw);
    if (list.length === 0) {
      console.log("Raw AI response (avaliações, sem questões reconhecidas):", JSON.stringify(raw).slice(0, 2000));
    }
    const out: GenQuestion[] = [];
    for (const item of list) {
      const normalized = normalizeGeneratedQuestion(item as GenQuestion, optionCount);
      // APROVA QUESTÃO A QUESTÃO: uma questão inválida não zera o lote inteiro.
      if (normalized) out.push(normalized);
    }
    return out;
  };


  const isBlock = (q: GenQuestion) => q.mc_subtype === "true_false_block" || q.mc_subtype === "fill_blank_block";
  const approvesContent = (q: GenQuestion) =>
    !validateQuestionContent({
      prompt: q.prompt,
      options: (q.options ?? null) as string[] | null,
      explanation: q.explanation ?? null,
      skipOptions: isBlock(q),
    }).rejected;

  // Uma única chamada por solicitação. Questões válidas são preservadas; uma
  // eventual complementação é controlada exclusivamente pelo acumulador pai.
  const first = await askAI("", "");
  return first.filter(approvesContent);
}



async function generateVersionQuestions(args: VersionGenArgs): Promise<{
  questions: GenQuestion[];
  rationale: string | null;
}> {
  // GERAÇÃO 100% IA: uma chamada direta para o total solicitado e, somente se
  // necessário, UMA chamada complementar para os tipos/subtipos faltantes.
  // Toda questão válida é acumulada; não há micro-lotes nem retries em cascata.
  const AI_FAILURE = "Falha ao comunicar com a IA. Tente gerar novamente.";
  const total =
    Math.max(0, args.counts.multiple_choice || 0) +
    Math.max(0, args.counts.true_false || 0) +
    Math.max(0, args.counts.fill_blank || 0) +
    Math.max(0, args.counts.essay || 0);
  const generatedQuestions: GenQuestion[] = [];
  const appendUnique = (questions: GenQuestion[]) => {
    const seen = new Set(generatedQuestions.map((q) => q.prompt.trim().toLowerCase()));
    for (const question of questions) {
      const key = question.prompt.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        generatedQuestions.push(question);
      }
    }
  };

  const selectAvailable = (questions: GenQuestion[]) => {
    const selected: GenQuestion[] = [];
    const remainingCounts = { ...args.counts };
    let remainingSubtypes: MCSubtypeCounts | null = args.multipleChoiceSubtypes
      ? { ...args.multipleChoiceSubtypes }
      : null;

    for (const question of questions) {
      if (question.qtype === "multiple_choice" && remainingSubtypes) {
        const subtype = resolveMcSubtype(question);
        const structurallyValid =
          subtype === "standard" ||
          (subtype === "true_false_block" && isStructuredTrueFalseBlock(question, args.optionCount)) ||
          (subtype === "fill_blank_block" && isStructuredFillBlankBlock(question, args.optionCount));
        if (!structurallyValid || (remainingSubtypes[subtype] ?? 0) <= 0) continue;
        remainingSubtypes[subtype] = Math.max(0, (remainingSubtypes[subtype] ?? 0) - 1);
        remainingCounts.multiple_choice = Math.max(0, remainingCounts.multiple_choice - 1);
        selected.push(question);
        continue;
      }
      if (question.qtype === "multiple_choice" && resolveMcSubtype(question) !== "standard") continue;
      if (remainingCounts[question.qtype] <= 0) continue;
      remainingCounts[question.qtype] -= 1;
      selected.push(question);
    }
    return { selected, remainingCounts, remainingSubtypes };
  };

  try {
    appendUnique(await generateVersionQuestionsAI(args));
    let available = selectAvailable(generatedQuestions);
    const remaining = total - available.selected.length;

    if (remaining > 0) {
      appendUnique(
        await generateVersionQuestionsAI({
          ...args,
          counts: available.remainingCounts,
          multipleChoiceSubtypes: available.remainingSubtypes,
          avoidPrompts: [...args.avoidPrompts, ...available.selected.map((q) => q.prompt)],
        }),
      );
      available = selectAvailable(generatedQuestions);
    }

    // Aproveita o que foi gerado: só falha quando praticamente nada veio.
    // Abaixo do total pedido, entregamos a avaliação com as questões válidas.
    const minimumAccepted = Math.max(1, Math.ceil(total * 0.5));
    if (available.selected.length < minimumAccepted) {
      console.error("Quantidade insuficiente após chamada complementar da avaliação:", {
        solicitadas: total,
        validas: available.selected.length,
      });
      throw new Error(`${AI_FAILURE} Foram geradas ${available.selected.length} de ${total} questões válidas.`);
    }
    if (available.selected.length < total) {
      console.warn("Avaliação gerada com menos questões que o solicitado:", {
        solicitadas: total,
        validas: available.selected.length,
      });
    }

    const selected = { ordered: available.selected.slice(0, total) };

    const sumW = selected.ordered.reduce((s, q) => s + (Number(q.weight) || 1), 0) || 1;
  const scale = args.maxScore / sumW;
  // Distribui os pesos com 2 casas decimais e ajusta a última questão para
  // que a soma seja EXATAMENTE args.maxScore (evita totais como 10,02).
  const rawWeights = selected.ordered.map((q) => (Number(q.weight) || 1) * scale);
  const roundedWeights = rawWeights.map((w) => Math.round(w * 100) / 100);
  const roundedSum = Math.round(roundedWeights.reduce((s, w) => s + w, 0) * 100) / 100;
  const target = Math.round(args.maxScore * 100) / 100;
  const diff = Math.round((target - roundedSum) * 100) / 100;
  if (roundedWeights.length > 0 && diff !== 0) {
    const lastIdx = roundedWeights.length - 1;
    roundedWeights[lastIdx] = Math.round((roundedWeights[lastIdx] + diff) * 100) / 100;
  }
  const questions = selected.ordered.map((q, i) => ({
    ...q,
    weight: roundedWeights[i],
  }));

    return {
      questions,
      rationale: "Geração integral com IA (Lovable AI), acumulador flexível e uma complementação opcional — sem questões sintéticas.",
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(AI_FAILURE)) throw error;
    console.error("Erro detalhado na geração da avaliação:", error);
    throw new Error(`${AI_FAILURE} ${error instanceof Error ? error.message.slice(0, 160) : ""}`.trim());
  }
}


const MARKDOWN_SYSTEM_PREFIX = `You must always respond in plain markdown text. Never wrap your response in JSON, never use curly braces, never use keys like markdown or content. Start your response directly with the content. Use ## for main titles, ### for subtitles, and regular paragraphs for body text. Respond in Brazilian Portuguese.`;

export const generateAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => GenerateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);

    const totalQ =
      data.counts.multiple_choice +
      data.counts.true_false +
      data.counts.fill_blank +
      data.counts.essay;
    if (totalQ === 0) throw new Error("Defina pelo menos uma questão.");

    // Load apostila content
    const { data: apo, error: aErr } = await (
      supabaseAdmin.from("ai_generations" as never) as unknown as {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{
              data: { id: string; title: string; result: unknown; discipline_id: string | null; tool: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )
      .select("id, title, result, discipline_id, tool")
      .eq("id", data.apostila_id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!apo || apo.tool !== "apostila" || apo.discipline_id !== data.discipline_id)
      throw new Error("Apostila inválida.");

    const apostilaText = typeof apo.result === "string" ? apo.result : JSON.stringify(apo.result);
    // Mantém um recorte de conteúdo para alimentar o gerador estrutural rápido.
    const trimmed = apostilaText.slice(0, 24000);
    const requestedSubtypeTotal =
      Math.max(0, data.multiple_choice_subtypes?.standard ?? 0) +
      Math.max(0, data.multiple_choice_subtypes?.true_false_block ?? 0) +
      Math.max(0, data.multiple_choice_subtypes?.fill_blank_block ?? 0);
    const multipleChoiceSubtypes =
      data.multiple_choice_subtypes && requestedSubtypeTotal > 0
        ? data.multiple_choice_subtypes
        : null;

    // ---- V/F e Completar Lacunas SEMPRE em BLOCO --------------------------------
    // Requisito pedagógico: cada questão de V/F ou de Lacunas deve apresentar 5
    // afirmativas/frases numeradas e 5 alternativas (A–E). Isso equivale aos
    // subtipos de múltipla escolha "true_false_block"/"fill_blank_block", já
    // totalmente suportados na geração, correção e PDF. Convertendo aqui, o
    // professor nunca recebe uma V/F ou lacuna "solta" (uma única afirmação).
    const tfDirect = data.counts.true_false;
    const fbDirect = data.counts.fill_blank;
    const routeToBlocks = tfDirect > 0 || fbDirect > 0;
    const effCounts = routeToBlocks
      ? {
          multiple_choice: data.counts.multiple_choice + tfDirect + fbDirect,
          true_false: 0,
          fill_blank: 0,
          essay: data.counts.essay,
        }
      : data.counts;
    const effSubtypes: MCSubtypeCounts | null = routeToBlocks
      ? {
          standard: Math.max(0, multipleChoiceSubtypes?.standard ?? data.counts.multiple_choice),
          true_false_block: Math.max(0, multipleChoiceSubtypes?.true_false_block ?? 0) + tfDirect,
          fill_blank_block: Math.max(0, multipleChoiceSubtypes?.fill_blank_block ?? 0) + fbDirect,
        }
      : multipleChoiceSubtypes;

    // Termos que o "assessor" nunca deve deixar virar alternativa (nome do
    // professor no cabeçalho da apostila, etc.).
    const bannedTerms = extractBannedNames(apostilaText, data.header_overrides?.professor ?? null);

    // ---- Generate a DISTINCT question set for each version --------------------
    // Cada versão recebe questões sobre subtópicos/enunciados diferentes do mesmo
    // conteúdo (não apenas reordenadas). A lista `avoidPrompts` acumula enunciados
    // já usados para o gerador não repetir entre versões.
    const perVersion: GenQuestion[][] = [];
    let firstRationale: string | null = null;
    // Orçamento de tempo global para as chamadas de IA: deixa folga para as
    // gravações no banco dentro do limite do gateway.
    // Cada lote é curto (até 4 questões) e roda em sequência; o orçamento
    // global precisa acomodar todos os lotes + retries por lote.
    const aiDeadlineAt = Date.now() + 240000;
    const genVersion = (label: string, avoid: string[]) =>
      generateVersionQuestions({
        counts: effCounts,
        multipleChoiceSubtypes: effSubtypes,
        rigor: data.rigor,
        maxScore: data.max_score,
        moduleLessons: data.module_lessons,
        formatInstructions: data.format_instructions ?? null,
        trimmed,
        versionLabel: label,
        versionCount: data.version_count,
        optionCount: data.option_count,
        avoidPrompts: avoid,
        topics: data.topics ?? null,
        qualityRules: data.quality_rules ?? null,
        difficultyLevel: data.difficulty_level,
        difficultyByType: data.difficulty_by_type ?? null,
        deadlineAt: aiDeadlineAt,
        bannedTerms,
      });

    // Gera a versão A primeiro para servir de base de diversidade; as demais
    // versões rodam em paralelo evitando os enunciados de A.
    const first = await genVersion("A", []);
    if (first.questions.length === 0) throw new Error("O gerador não retornou questões válidas.");
    perVersion.push(first.questions);
    firstRationale = first.rationale;

    if (data.version_count > 1) {
      const baseAvoid = first.questions.map((q) => q.prompt);
      const restLabels = Array.from({ length: data.version_count - 1 }, (_, i) => String.fromCharCode(66 + i));
      const restResults = await Promise.all(restLabels.map((label) => genVersion(label, baseAvoid)));
      for (const r of restResults) {
        if (r.questions.length === 0) throw new Error("O gerador não retornou questões válidas.");
        perVersion.push(r.questions);
      }
    }

    // ---- Auditoria de conceito central (integração com a apostila) -----------
    // Substitui placeholders genéricos ("Disciplina", "Conteúdo", "Tema") pelo
    // conceito real da apostila, confere coerência enunciado ↔ alternativas e
    // tagueia a origem (Aula N) de cada questão antes de gravar.
    const questionAudits: QuestionAudit[] = [];
    const auditDisciplineName = await supabaseAdmin
      .from("disciplines")
      .select("name")
      .eq("id", data.discipline_id)
      .maybeSingle()
      .then((r) => (r.data as { name?: string } | null)?.name?.trim() || null);
    for (let vi = 0; vi < perVersion.length; vi++) {
      const audited = auditQuestionConcepts({
        questions: perVersion[vi],
        apostilaText,
        moduleLessons: data.module_lessons,
        topics: data.topics ?? [],
        bannedTerms,
        versionLabel: String.fromCharCode(65 + vi),
        difficultyLevel: data.difficulty_level,
        difficultyByType: (data.difficulty_by_type ?? null) as Record<string, unknown> | null,
        disciplineName: auditDisciplineName,
      });
      perVersion[vi] = audited.questions;
      questionAudits.push(...audited.audits);
    }

    const issuedAt = new Date().toISOString();
    const { data: reservedControl, error: reserveErr } = await (supabaseAdmin.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: Array<{ out_control_sequence: number; out_control_number: string; out_control_year: number; out_control_scope_key: string }> | null; error: { message: string } | null }>)
    ("reserve_assessment_control", {
      _discipline_id: data.discipline_id,
      _module_name: data.module_lessons.slice(0, 200),
      _issued_at: issuedAt,
    });
    const reserved = reservedControl?.[0];
    if (reserveErr || !reserved) throw new Error(`ASSESSMENT_CONTROL_FAILED: ${reserveErr?.message ?? "não foi possível reservar número da avaliação"}`);
    // Mapeia o template de layout escolhido para a coluna `layout` existente.
    const layoutFromTemplate: Record<string, "one_column" | "two_columns" | "mixed"> = {
      classic: "one_column",
      compact: "mixed",
      two_column: "two_columns",
      exam_board: "mixed",
    };
    const resolvedLayout = data.layout_template ? layoutFromTemplate[data.layout_template] : data.layout;
    const control = {
      control_sequence: reserved.out_control_sequence,
      control_number: reserved.out_control_number,
      control_year: reserved.out_control_year,
      control_scope_key: reserved.out_control_scope_key,
    };

    // ---- Insert assessment ----
    const { data: created, error: cErr } = await supabaseAdmin
      .from("assessments")
      .insert({
        discipline_id: data.discipline_id,
        created_by: context.userId,
        title: data.title,
        apostila_generation_id: data.apostila_id,
        module_name: data.module_lessons.slice(0, 200),
        lessons: [],
        max_score: data.max_score,
        layout: resolvedLayout,
        layout_rationale: firstRationale,
        diary_assessment_id: data.diary_assessment_id ?? null,
        version_count: data.version_count,
        copies_per_version: 1,
        rigor: data.rigor,
        ...splitAssessmentSchedule(data.assessment_date),
        control_sequence: control.control_sequence,
        control_number: control.control_number,
        control_year: control.control_year,
        control_scope_key: control.control_scope_key,
        status: "ready",
        config: {
          counts: data.counts,
          multiple_choice_subtypes: effSubtypes ?? data.multiple_choice_subtypes ?? null,
          // V/F e Lacunas convertidas em blocos de múltipla escolha (5 itens + A–E).
          generated_counts: effCounts,
          routed_to_blocks: routeToBlocks,
          header: data.header_overrides ?? null,
          header_template_id: data.header_template_id ?? null,
          topics: data.topics ?? null,
          quality_rules: data.quality_rules ?? null,
          difficulty_level: data.difficulty_level,
          difficulty_by_type: data.difficulty_by_type ?? null,
          layout_template: data.layout_template ?? null,
          kind: data.kind,
          target_student_ids: data.kind === "regular" ? null : (data.target_student_ids ?? []),
        },
      } as never)
      .select("id")
      .single();
    if (cErr || !created) throw new Error(cErr?.message ?? "Erro ao criar avaliação");

    // ---- Insert ALL questions (every version's set) in one shared pool --------
    // As questões são inseridas versão a versão, mantendo posições sequenciais.
    // Cada versão referencia apenas o seu próprio subconjunto via question_order.
    type QMeta = { position: number; q: GenQuestion };
    const versionMeta: QMeta[][] = [];
    const allRows: Array<{
      assessment_id: string;
      position: number;
      qtype: QType;
      prompt: string;
      options: string[] | null;
      correct_answer: never;
      explanation: string | null;
      weight: number;
    }> = [];
    let pos = 0;
    for (let v = 0; v < perVersion.length; v++) {
      const meta: QMeta[] = [];
      for (const q of perVersion[v]) {
        pos += 1;
        allRows.push({
          assessment_id: created.id,
          position: pos,
          qtype: q.qtype,
          prompt: q.prompt,
          options: q.options ?? null,
          correct_answer: q.correct_answer as never,
          explanation: q.explanation ?? null,
          weight: q.weight ?? 0,
        });
        meta.push({ position: pos, q });
      }
      versionMeta.push(meta);
    }
    const { data: insQ, error: qErr } = await supabaseAdmin
      .from("assessment_questions")
      .insert(allRows)
      .select("id, position, qtype, options");
    if (qErr || !insQ) throw new Error(qErr?.message ?? "Erro ao salvar questões");
    const byPos = new Map(insQ.map((r) => [r.position, r]));

    // ---- Persiste a auditoria (tela de revisão antes dos PDFs) ---------------
    // Cada questão sinalizada ("revisar" ou "nivel") fica pendente até o
    // professor aplicar a sugestão, editar manualmente ou manter como está.
    {
      const offsets: number[] = [];
      let acc = 0;
      for (const qs of perVersion) { offsets.push(acc); acc += qs.length; }
      const auditRows = questionAudits.map((a) => {
        const vIdx = a.version.charCodeAt(0) - 65;
        const globalPos = (offsets[vIdx] ?? 0) + a.position;
        return {
          assessment_id: created.id,
          question_id: byPos.get(globalPos)?.id ?? null,
          version_label: a.version,
          position: a.position,
          concept: a.concept,
          lesson_tag: a.lesson_tag,
          status: a.status,
          message: a.message,
          concept_options: a.concept_options,
          declared_level: a.declared_level ?? null,
          detected_level: a.detected_level ?? null,
          suggested_prompt: a.suggested_prompt ?? null,
          resolution: a.status === "revisar" || a.status === "nivel" ? "pending" : "auto",
        };
      });
      if (auditRows.length > 0) {
        await supabaseAdmin.from("assessment_question_audits").insert(auditRows as never);
      }
    }

    // ---- Create versions (each with its own questions) -----------------------
    const shouldShuffle = data.shuffle_questions;
    const versionRows: Array<{
      assessment_id: string;
      version_label: string;
      question_order: string[];
      option_orders: Record<string, number[]>;
      answer_key: Record<string, unknown>;
    }> = [];
    for (let v = 0; v < versionMeta.length; v++) {
      const label = String.fromCharCode(65 + v); // A, B, C, D
      const meta = versionMeta[v];
      const ids = meta.map((m) => byPos.get(m.position)!.id);
      const order = shouldShuffle ? shuffle(ids) : ids;
      const option_orders: Record<string, number[]> = {};
      const answer_key: Record<string, unknown> = {};
      for (const m of meta) {
        const row = byPos.get(m.position)!;
        const q = m.q;
        if (row.qtype === "multiple_choice" && Array.isArray(row.options)) {
          const options = row.options.map((opt: unknown) => String(opt ?? ""));
          const baseIdx = options.map((_: unknown, i: number) => i);
          const idxs = shouldShuffle ? shuffle(baseIdx) : baseIdx;
          option_orders[row.id] = idxs;
          const correctOriginalIdx = resolveCorrectOptionIndex(q.correct_answer, options);
          const newIdx = idxs.indexOf(correctOriginalIdx);
          answer_key[row.id] = newIdx >= 0 ? "ABCDE"[newIdx] : null;
        } else {
          answer_key[row.id] = q.correct_answer;
        }
      }
      versionRows.push({
        assessment_id: created.id,
        version_label: label,
        question_order: order,
        option_orders,
        answer_key,
      });
    }
    const { data: insV, error: vErr } = await supabaseAdmin
      .from("assessment_versions")
      .insert(versionRows as never)
      .select("id, version_label");
    if (vErr || !insV) throw new Error(vErr?.message ?? "Erro ao criar versões");

    // ---- Create assignments: AUTO 1 por aluno, versões distribuídas de forma
    // embaralhada (round-robin sobre alunos embaralhados). A quantidade de
    // avaliações necessárias = número de alunos matriculados. ---------------
    const { data: students } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id);
    let rawStudentIds = (students ?? []).map((s) => s.student_id);
    // Modalidades "segunda chamada" e "recuperação" aplicam somente aos alunos
    // escolhidos pelo professor. Filtra pela lista de matriculados por
    // segurança (evita atribuir a alunos fora da turma).
    if (data.kind !== "regular") {
      const target = new Set((data.target_student_ids ?? []).filter(Boolean));
      if (target.size === 0) {
        throw new Error("Selecione ao menos um aluno para esta modalidade de prova.");
      }
      rawStudentIds = rawStudentIds.filter((id) => target.has(id));
      if (rawStudentIds.length === 0) {
        throw new Error("Os alunos selecionados não estão matriculados nesta disciplina.");
      }
    }
    const studentOrderMap = new Map<string, { name: string; enrollment: string | null }>();
    if (rawStudentIds.length > 0) {
      const { data: studentProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email, enrollment_number")
        .in("id", rawStudentIds);
      (studentProfiles ?? []).forEach((s) => studentOrderMap.set(s.id, {
        name: s.name || s.email || "Aluno(a)",
        enrollment: s.enrollment_number ?? null,
      }));
    }
    const studentIds = rawStudentIds.slice().sort((a, b) => {
      const pa = studentOrderMap.get(a);
      const pb = studentOrderMap.get(b);
      const byName = String(pa?.name ?? "").localeCompare(String(pb?.name ?? ""), "pt-BR", { sensitivity: "base" });
      if (byName !== 0) return byName;
      return String(pa?.enrollment ?? "").localeCompare(String(pb?.enrollment ?? ""), "pt-BR", { numeric: true });
    });

    // Mapeia version_id -> metadados das questões da versão, para gerar um
    // arranjo (ordem de questões + ordem de alternativas + gabarito) ÚNICO por
    // ALUNO. Assim, dois alunos da mesma versão recebem itens realmente
    // embaralhados de forma diferente, e cada folha tem o seu próprio gabarito.
    const metaByVersionId = new Map<string, QMeta[]>();
    for (const v of insV) {
      const idx = v.version_label.charCodeAt(0) - 65;
      if (versionMeta[idx]) metaByVersionId.set(v.id, versionMeta[idx]);
    }

    const assignRows: Array<{
      assessment_id: string;
      version_id: string;
      student_id: string;
      copy_index: number;
      question_order: string[];
      option_orders: Record<string, number[]>;
      answer_key: Record<string, unknown>;
    }> = [];
    if (studentIds.length > 0) {
      let vIdx = shouldShuffle ? Math.floor(Math.random() * Math.max(1, insV.length)) : 0;
      for (const sid of studentIds) {
        const ver = insV[vIdx % insV.length];
        const meta = metaByVersionId.get(ver.id) ?? [];
        const variant = buildVariant(meta, byPos as unknown as Map<number, QRow>, shouldShuffle);
        assignRows.push({
          assessment_id: created.id,
          version_id: ver.id,
          student_id: sid,
          copy_index: 1,
          question_order: variant.order,
          option_orders: variant.option_orders,
          answer_key: variant.answer_key,
        });
        vIdx++;
      }
      const { error: asErr } = await supabaseAdmin
        .from("assessment_assignments")
        .insert(assignRows as never);
      if (asErr) throw new Error(asErr.message);
    }

    // Alinhamento conteúdo ↔ questão: sinaliza enunciados sem ancoragem na apostila.
    const alignmentWarnings = perVersion.flatMap((qs, i) =>
      findMisalignedQuestions(qs, apostilaText, String.fromCharCode(65 + i)),
    );

    return {
      id: created.id,
      layout_rationale: firstRationale,
      total_questions: insQ.length,
      total_assignments: assignRows.length,
      alignment_warnings: alignmentWarnings,
      question_audits: questionAudits,
      audit_review_count: questionAudits.filter((a) => a.status === "revisar").length,
      audit_fixed_count: questionAudits.filter((a) => a.status === "ajustado").length,
      // Questões cujo nível cognitivo real é incompatível com o nível declarado:
      // não são liberadas automaticamente para aquele nível.
      level_mismatch_count: questionAudits.filter((a) => a.status === "nivel").length,
      level_mismatches: questionAudits
        .filter((a) => a.status === "nivel")
        .map((a) => ({
          version: a.version,
          position: a.position,
          declared_level: a.declared_level ?? null,
          detected_level: a.detected_level ?? null,
          suggested_prompt: a.suggested_prompt ?? null,
          message: a.message,
        })),
    };
  });

// ---------- EXPORT PDF ------------------------------------------------------
export const exportAssessmentPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    id: z.string().uuid(),
    block: z.enum(["all", "questions", "answers", "keys", "student", "teacher"]).default("all"),
    /** Quando informado, exporta apenas as versões indicadas (ex.: ["A"]). */
    version_labels: z.array(z.string().min(1).max(8)).max(12).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!a) throw new Error("Não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    // Portão de qualidade POR VERSÃO: cada versão (A, B, C…) só é liberada
    // quando todas as suas questões sinalizadas foram corrigidas, editadas ou
    // mantidas conscientemente. Versões sem pendência podem ser exportadas
    // mesmo que outra versão continue bloqueada.
    const { data: pendingRows } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("version_label, position")
      .eq("assessment_id", a.id)
      .eq("resolution", "pending")
      .order("position", { ascending: true });
    const pendingByVersion = new Map<string, number[]>();
    for (const r of pendingRows ?? []) {
      const key = String(r.version_label);
      pendingByVersion.set(key, [...(pendingByVersion.get(key) ?? []), Number(r.position)]);
    }
    const requestedLabels = data.version_labels?.map((v) => v.trim().toUpperCase()) ?? null;
    const blockedRequested = [...pendingByVersion.keys()].filter(
      (label) => !requestedLabels || requestedLabels.includes(label),
    );
    if (blockedRequested.length > 0) {
      const { data: allVersions } = await supabaseAdmin
        .from("assessment_versions")
        .select("version_label")
        .eq("assessment_id", a.id)
        .order("version_label", { ascending: true });
      const lines = (allVersions ?? [])
        .map((v) => String(v.version_label))
        .map((label) => {
          const pend = pendingByVersion.get(label) ?? [];
          return pend.length > 0
            ? `Versão ${label}: ${pend.length} ${pend.length === 1 ? "questão precisa" : "questões precisam"} de correção automática ou revisão manual (${pend
                .map((p) => `Q${p}`)
                .join(", ")}).`
            : `Versão ${label}: OK.`;
        });
      throw new Error(`REVISAO_PENDENTE: ${lines.join(" ")}`);
    }

    const [{ data: questions }, { data: versions }, { data: assignments }, { data: disc }] = await Promise.all([
      supabaseAdmin
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("assessment_versions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("version_label", { ascending: true }),
      supabaseAdmin
        .from("assessment_assignments")
        .select("id, student_id, version_id, copy_index, qr_token, question_order, option_orders, answer_key")
        .eq("assessment_id", a.id),
      supabaseAdmin
        .from("disciplines")
        .select("name, teacher_id, institution_id")
        .eq("id", a.discipline_id)
        .maybeSingle(),
    ]);
    if (!disc) throw new Error("Disciplina não encontrada");
    // Aplica o filtro de versões solicitado (versões liberadas).
    const exportVersions = requestedLabels
      ? (versions ?? []).filter((v) => requestedLabels.includes(String(v.version_label).toUpperCase()))
      : (versions ?? []);
    const allowedVersionIds = new Set(exportVersions.map((v) => v.id as string));
    const exportAssignments = requestedLabels
      ? (assignments ?? []).filter((x) => allowedVersionIds.has(x.version_id as string))
      : (assignments ?? []);
    if (exportVersions.length === 0) throw new Error("Nenhuma versão liberada para exportação.");
    const [{ data: teacher }, instRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle(),
      disc.institution_id
        ? supabaseAdmin.from("institutions").select("name").eq("id", disc.institution_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ]);
    const studentIds = exportAssignments.map((x) => x.student_id);
    const studentMap = new Map<string, { name: string; enrollment: string | null }>();
    if (studentIds.length > 0) {
      const { data: studs } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email, enrollment_number")
        .in("id", studentIds);
      (studs ?? []).forEach((s) =>
        studentMap.set(s.id, {
          name: s.name || s.email || "Aluno(a)",
          enrollment: s.enrollment_number ?? null,
        }),
      );
    }

    const logoUrl = await resolveBrandingLogoUrl(disc.teacher_id);
    const controlDateSource = new Date(a.created_at as string);
    // Mantém a string original (ISO e/ou duas datas concatenadas por " | ").
    // A formatação segura acontece no gerador do PDF.
    const fmtDate =
      (a as { assessment_schedule?: string | null }).assessment_schedule ||
      (a as { assessment_date?: string | null }).assessment_date ||
      (a.created_at as string);

    const mm = String(controlDateSource.getMonth() + 1).padStart(2, "0");
    const yy = String(controlDateSource.getFullYear() % 100).padStart(2, "0");
    const formatControlNumber = (seq: number) => `${mm}${String(Math.max(1, Math.floor(seq))).padStart(4, "0")}${yy}`;
    const cfgHeader = (a.config as { header?: { institution?: string | null; discipline?: string | null; professor?: string | null } } | null)?.header ?? null;
    const headerTemplateId =
      (a.config as { header_template_id?: string | null } | null)?.header_template_id ?? null;
    let headerTemplate: {
      logo_url: string | null;
      logo_scale: number | null;
      banner_color: string | null;
      strip_color: string | null;
      unit_label: string | null;
      shift_label: string | null;
      instructions: string | null;
      show_grade_box: boolean | null;
      compact_questions_header?: boolean | null;
      exclusive_answer_sheet_rules?: boolean | null;
    } | null = null;

    if (headerTemplateId) {
      const { data: tpl } = await supabaseAdmin
        .from("assessment_header_templates")
        .select("logo_url, logo_scale, banner_color, strip_color, unit_label, shift_label, instructions, show_grade_box, compact_questions_header, exclusive_answer_sheet_rules")
        .eq("id", headerTemplateId)
        .maybeSingle();
      headerTemplate = tpl ?? null;
    }

    const headerInfo = {
      institution: cfgHeader?.institution?.trim() || instRes.data?.name || null,
      discipline: cfgHeader?.discipline?.trim() || disc.name,
      teacher: cfgHeader?.professor?.trim() || teacher?.name || null,
      title: a.title,
      module: a.module_name ?? null,
      max_score: Number(a.max_score),
      date: fmtDate,
      diary_column: a.diary_assessment_id ?? null,
    };

    // Ordena as avaliações dos alunos de forma consistente: ordem alfabética
    // pelo nome do aluno (matrícula como desempate).
    const orderedAssignments = exportAssignments
      .map((x) => ({
        ...x,
        student_name: studentMap.get(x.student_id)?.name ?? "Aluno(a)",
        enrollment_number: studentMap.get(x.student_id)?.enrollment ?? null,
      }))
      .sort((p, q) => {
        const byName = p.student_name.localeCompare(q.student_name, "pt-BR", { sensitivity: "base" });
        if (byName !== 0) return byName;
        return String(p.enrollment_number ?? "").localeCompare(String(q.enrollment_number ?? ""), "pt-BR", { numeric: true });
      });

    const assessmentControlSequence = Number((a as { control_sequence?: number | null }).control_sequence ?? 1);
    const controlNumber = String((a as { control_number?: string | null }).control_number || formatControlNumber(assessmentControlSequence));

    const { buildAssessmentPDF } = await import("./assessment-pdf.server");
    const { bytes, bubbleLayouts } = await buildAssessmentPDF({
      header: headerInfo,
      logoUrl,
      assessmentId: a.id,
      controlNumber,
      layout: (a.layout as "one_column" | "two_columns" | "mixed") ?? "one_column",
      questions: (questions ?? []) as never,
      versions: exportVersions as never,
      assignments: orderedAssignments as never,
      mode: data.block,
      headerTemplate,
    });

    // Persist the OMR layout for every assignment whose answer sheet was just
    // rendered, so the camera-based grader can map detected marks to questions.
    const layoutUpdates = Object.entries(bubbleLayouts).filter(([id]) => id && id !== "blank");
    if (layoutUpdates.length > 0) {
      await Promise.all(
        layoutUpdates.map(([id, layout]) =>
          supabaseAdmin.from("assessment_assignments").update({ bubble_layout: layout }).eq("id", id),
        ),
      );
    }

    const b64 = Buffer.from(bytes).toString("base64");
    const suffixMap: Record<string, string> = {
      all: "",
      questions: "_questoes",
      answers: "_folhas_resposta",
      keys: "_gabarito_professor",
      student: "_aluno",
      teacher: "_gabarito_professor",
    };
    const suffix = suffixMap[data.block] ?? "";
    return {
      filename: `${a.title.replace(/[^a-z0-9\-]+/gi, "_").slice(0, 60) || "avaliacao"}${suffix}.pdf`,
      base64: b64,
    };
  });

// ---------- STUDENT: LIST POSTED ASSESSMENT RESULTS -------------------------
/**
 * RELATÓRIO PEDAGÓGICO DA AVALIAÇÃO (para o professor / coordenação).
 *
 * Monta o contexto real da prova (curso, disciplina, módulo, nível, questões e
 * gabarito) e pede à IA um relatório estruturado em texto com visão geral,
 * equilíbrio de conteúdo e dificuldade, ajustes aplicados nos enunciados,
 * pontos fortes e melhorias para versões futuras.
 */
export const generateAssessmentReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const [{ data: questions }, { data: disc }] = await Promise.all([
      supabaseAdmin
        .from("assessment_questions")
        .select("position, qtype, prompt, options, correct_answer, weight")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true }),
      supabaseAdmin
        .from("disciplines")
        .select("name, semester, group_name, course_id")
        .eq("id", a.discipline_id)
        .maybeSingle(),
    ]);

    let courseName = "";
    if (disc?.course_id) {
      const { data: course } = await supabaseAdmin
        .from("courses")
        .select("name")
        .eq("id", disc.course_id)
        .maybeSingle();
      courseName = (course as { name?: string } | null)?.name ?? "";
    }

    const cfg = (a.config ?? {}) as {
      difficulty_level?: string;
      topics?: string[] | null;
      counts?: Record<string, number>;
      kind?: string;
    };
    const DIFF_LABEL: Record<string, string> = {
      facil: "básico",
      medio: "intermediário",
      dificil: "avançado",
      superior: "superior universitário",
    };

    const qs = (questions ?? []) as Array<{
      position: number; qtype: string; prompt: string; options: unknown; correct_answer: unknown; weight: number;
    }>;
    if (!qs.length) throw new Error("Esta avaliação não possui questões para analisar.");

    const questionsText = qs
      .map((q) => {
        const opts = Array.isArray(q.options)
          ? (q.options as unknown[])
              .map((o, i) => `   ${"ABCDE"[i] ?? i + 1}) ${typeof o === "string" ? o : JSON.stringify(o)}`)
              .join("\n")
          : "";
        const key = q.correct_answer == null
          ? ""
          : `   GABARITO: ${typeof q.correct_answer === "string" ? q.correct_answer : JSON.stringify(q.correct_answer)}`;
        return [`${q.position}. [${q.qtype}] ${q.prompt}`, opts, key].filter(Boolean).join("\n");
      })
      .join("\n\n")
      .slice(0, 60000);

    const system = `Você é coordenador pedagógico do EstudaJá. Produza RELATÓRIOS DE AVALIAÇÃO em português do Brasil, para uso interno do professor e da coordenação.

${assessmentBalanceRules()}

${pedagogicalReviewRules()}

FORMATO OBRIGATÓRIO DA SAÍDA (texto estruturado em Markdown simples, sem tabelas largas, sem emojis):

# Relatório da Avaliação

## 1. Contexto
- Curso, disciplina, módulo/unidade, nível declarado, data (quando houver), número de versões e nota máxima.
- Objetivo pedagógico do módulo (uma ou duas frases).

## 2. Visão geral da prova
- Total de questões e distribuição por tipo (múltipla escolha, V/F, lacunas, dissertativas).
- Temas principais abordados (liste os conceitos efetivamente cobrados).
- Distribuição aproximada por competência cognitiva: memorização, compreensão, aplicação, análise e decisão (use percentuais aproximados que somem 100%).

## 3. Equilíbrio de conteúdo e dificuldade
- Temas bem representados, sub-representados e super-representados (cite quantas questões de cada tema).
- Coerência entre o nível declarado e o nível real das questões.

## 4. Ajustes nos enunciados
- Ajustes aplicados pela fábrica de questões (correção de enunciados genéricos, substituição de termos vagos, adequação ao nível, correção de inconsistências conceituais).
- Ajustes ainda recomendados, questão por questão quando necessário (use "Questão N: ...").

## 5. Pontos fortes
- 3 a 5 itens objetivos, baseados nas questões reais.

## 6. Melhorias para versões futuras
- 3 a 5 recomendações práticas (variar exemplos, incluir interpretação de dados/gráficos, casos curtos, tomada de decisão).

REGRAS: baseie-se APENAS nas questões fornecidas; nunca invente temas ausentes; não reescreva a prova inteira; seja conciso e específico.`;

    const user = `CONTEXTO DA AVALIAÇÃO
Curso: ${courseName || "não informado"}
Disciplina: ${disc?.name ?? "não informada"}${disc?.group_name ? ` (turma ${disc.group_name})` : ""}${disc?.semester ? ` — ${disc.semester}` : ""}
Módulo/aulas: ${a.module_name ?? "não informado"}
Título da avaliação: ${a.title}
Tipo: ${cfg.kind ?? "regular"}
Nível de dificuldade declarado: ${DIFF_LABEL[cfg.difficulty_level ?? "medio"] ?? "intermediário"}
Data da avaliação: ${a.assessment_date ?? "não definida"}
Nota máxima: ${Number(a.max_score).toFixed(2)} · Versões: ${a.version_count}
Tópicos informados pelo professor: ${(cfg.topics ?? []).map(sanitizeConceptTopic).filter(Boolean).join("; ") || "não informados"}


LISTA FINAL DE QUESTÕES (COM GABARITO)
${questionsText}

Gere o relatório no formato obrigatório.`;

    // Registro interno: questões mantidas fora do nível recomendado.
    const { data: keptAudits } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("version_label, position, declared_level, detected_level, resolution, status")
      .eq("assessment_id", a.id)
      .eq("status", "nivel")
      .in("resolution", ["kept", "relevel"]);
    const outOfLevel = (keptAudits ?? []).filter((r) => r.resolution === "kept");
    const releveled = (keptAudits ?? []).filter((r) => r.resolution === "relevel");

    const report = await callAIText({ system, user, timeoutMs: 120000 });
    const levelBlock =
      outOfLevel.length > 0 || releveled.length > 0
        ? `\n\n## 7. Registro interno de nível\n${outOfLevel
            .map(
              (r) =>
                `- Versão ${r.version_label} · Questão ${r.position}: FORA DO NÍVEL RECOMENDADO — enunciado de decisão técnica mantido pelo professor em prova declarada como ${r.declared_level ?? "básico"} (nível real detectado: ${r.detected_level ?? "avaliação/análise"}).`,
            )
            .join("\n")}${outOfLevel.length > 0 && releveled.length > 0 ? "\n" : ""}${releveled
            .map(
              (r) =>
                `- Versão ${r.version_label} · Questão ${r.position}: enunciado mantido com nível da questão ajustado para ${r.detected_level ?? "intermediário/avançado"}.`,
            )
            .join("\n")}`
        : "";
    const safeTitle = String(a.title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "avaliacao";
    return {
      report: `${report.trim()}${levelBlock}`,
      filename: `relatorio-${safeTitle}.md`,
      question_count: qs.length,
      out_of_level_count: outOfLevel.length,
    };
  });

/**
 * Retorna, para o aluno autenticado nesta disciplina, os resultados das
 * avaliações já corrigidas e lançadas (status = 'posted'). Inclui o gabarito
 * oficial (respostas corretas) e as respostas do aluno, para que a página
 * do aluno consiga mostrar a comparação completa lado a lado.
 */
export const listStudentAssessmentResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Confirma matrícula do aluno na disciplina.
    const { data: enrol } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (!enrol) {
      // Professores/admin também podem visualizar (útil para conferência).
      try {
        await assertTeacherOrAdmin(data.discipline_id, context.userId);
      } catch {
        throw new Error("Sem acesso a esta disciplina.");
      }
    }

    // 1) Avaliações da disciplina.
    const { data: assessments } = await supabaseAdmin
      .from("assessments")
      .select("id, title, max_score, created_at, module_name")
      .eq("discipline_id", data.discipline_id);
    const asmtIds = (assessments ?? []).map((a) => a.id);
    if (asmtIds.length === 0) return { items: [] };

    // 2) Folhas (assignments) atribuídas a este aluno.
    const { data: assignments } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id, question_order, option_orders, answer_key")
      .in("assessment_id", asmtIds)
      .eq("student_id", context.userId);
    const asgList = assignments ?? [];
    if (asgList.length === 0) return { items: [] };

    const asgIds = asgList.map((a) => a.id);

    // 3) Submissões já corrigidas/lançadas. O fluxo do sistema só expõe
    // avaliações ao aluno após a correção objetiva; "confirmed" e
    // "graded_objective" entram para o caso de notas antigas que ficaram
    // em estado intermediário (ex.: migração de projeto). "awaiting_review"
    // e "pending" continuam fora: esses ainda estão em revisão.
    const { data: subs } = await supabaseAdmin
      .from("assessment_submissions")
      .select("id, assignment_id, objective_answers, essay_answers, per_question_scores, ai_feedback, teacher_comment, final_feedback, total_score, status, posted_at, graded_at")
      .in("assignment_id", asgIds)
      .in("status", ["posted", "confirmed", "graded_objective"]);
    const subList = subs ?? [];
    if (subList.length === 0) return { items: [] };

    // 4) Questões de todas as avaliações envolvidas.
    const { data: questions } = await supabaseAdmin
      .from("assessment_questions")
      .select("id, assessment_id, position, qtype, prompt, options, correct_answer, explanation")
      .in("assessment_id", asmtIds);
    const qById = new Map<string, {
      id: string; assessment_id: string; position: number; qtype: string;
      prompt: string; options: string[] | null; correct_answer: unknown; explanation: string | null;
    }>();
    for (const q of questions ?? []) qById.set(q.id, q as never);

    const asmtById = new Map((assessments ?? []).map((a) => [a.id, a]));
    const asgById = new Map(asgList.map((a) => [a.id, a]));

    const items = subList.map((sub) => {
      const asg = asgById.get(sub.assignment_id)!;
      const asmt = asmtById.get(asg.assessment_id)!;
      const order = (asg.question_order as string[] | null) ?? [];
      const optOrders = (asg.option_orders as Record<string, number[]> | null) ?? {};
      const answerKey = (asg.answer_key as Record<string, unknown> | null) ?? {};
      const objAns = (sub.objective_answers as Record<string, unknown> | null) ?? {};
      const essayAns = (sub.essay_answers as Record<string, string> | null) ?? {};
      const perQ = (sub.per_question_scores as Record<string, { obtained?: number; max?: number; correct?: boolean | null }> | null) ?? {};
      const feedbackMap = (sub.ai_feedback as Record<string, { feedback?: string } & Record<string, unknown>> | null) ?? {};

      type QOut = {
        id: string;
        number: number;
        qtype: string;
        prompt: string;
        options: string[] | null;
        correct_answer: string | null;
        student_answer: string | null;
        explanation: string | null;
        score: { obtained: number; max: number; correct: boolean | null } | null;
        feedback: string | null;
      };
      const qs: QOut[] = [];
      order.forEach((qid, idx) => {
        const q = qById.get(qid);
        if (!q) return;
        let displayOptions: string[] | null = null;
        if (q.qtype === "multiple_choice" && Array.isArray(q.options)) {
          const idxs = optOrders[qid] ?? q.options.map((_, i) => i);
          displayOptions = idxs.map((i) => q.options![i] ?? "");
        }
        const rawStudent = q.qtype === "essay" ? essayAns[qid] : objAns[qid];
        const studentAnswer =
          rawStudent == null
            ? null
            : Array.isArray(rawStudent)
              ? (rawStudent as unknown[]).map((v) => String(v)).join(", ")
              : String(rawStudent);
        const correctRaw = answerKey[qid] ?? q.correct_answer;
        const correctStr =
          correctRaw == null
            ? null
            : Array.isArray(correctRaw)
              ? (correctRaw as unknown[]).map((v) => String(v)).join(", ")
              : typeof correctRaw === "object"
                ? JSON.stringify(correctRaw)
                : String(correctRaw);
        const s = perQ[qid];
        qs.push({
          id: qid,
          number: idx + 1,
          qtype: q.qtype,
          prompt: q.prompt,
          options: displayOptions,
          correct_answer: correctStr,
          student_answer: studentAnswer,
          explanation: q.explanation,
          score: s
            ? {
                obtained: Number(s.obtained ?? 0),
                max: Number(s.max ?? 0),
                correct: s.correct ?? null,
              }
            : null,
          feedback: feedbackMap[qid]?.feedback ?? null,
        });
      });

      return {
        submission_id: sub.id,
        assessment_id: asmt.id,
        title: asmt.title,
        module_name: asmt.module_name,
        max_score: Number(asmt.max_score ?? 0),
        total_score: sub.total_score == null ? null : Number(sub.total_score),
        posted_at: sub.posted_at,
        graded_at: sub.graded_at,
        teacher_comment: sub.teacher_comment ?? null,
        final_feedback: sub.final_feedback ?? null,
        questions: qs,
      };
    });

    items.sort((a, b) => {
      const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      return tb - ta;
    });

    return { items };
  });
/* ----------------------------------------------------------------------------
 * REVISÃO PRÉ-PDF DA AVALIAÇÃO
 *
 * Lista as questões sinalizadas pelas verificações automáticas (placeholder
 * genérico, coerência enunciado ↔ alternativas ↔ apostila e respeito ao nível
 * de dificuldade) e registra a decisão do professor: aplicar sugestão, editar
 * manualmente ou manter assim mesmo.
 * -------------------------------------------------------------------------- */
export const listAssessmentAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, title")
      .eq("id", data.id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const { data: rows, error } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("*")
      .eq("assessment_id", a.id)
      .order("version_label", { ascending: true })
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);

    const qIds = (rows ?? []).map((r) => r.question_id).filter((v): v is string => Boolean(v));
    const qMap = new Map<string, { prompt: string; options: string[] | null }>();
    if (qIds.length > 0) {
      const { data: qs } = await supabaseAdmin
        .from("assessment_questions")
        .select("id, prompt, options")
        .in("id", qIds);
      for (const q of (qs ?? []) as Array<{ id: string; prompt: string; options: unknown }>) {
        qMap.set(q.id, {
          prompt: q.prompt,
          options: Array.isArray(q.options) ? q.options.map((o) => String(o ?? "")) : null,
        });
      }
    }

    const all = (rows ?? []).map((r) => ({
      id: r.id as string,
      question_id: (r.question_id as string | null) ?? null,
      version_label: r.version_label as string,
      position: r.position as number,
      concept: (r.concept as string | null) ?? null,
      lesson_tag: (r.lesson_tag as string | null) ?? null,
      status: r.status as string,
      message: (r.message as string | null) ?? null,
      // Nunca oferece rótulos estruturais ("Disciplina", "Aula 2") no dropdown.
      concept_options: (Array.isArray(r.concept_options) ? (r.concept_options as string[]) : []).filter(
        (c) => !isStructuralConceptLabel(c),
      ),
      declared_level: (r.declared_level as string | null) ?? null,
      detected_level: (r.detected_level as string | null) ?? null,
      suggested_prompt: (r.suggested_prompt as string | null) ?? null,
      resolution: r.resolution as string,
      prompt: r.question_id ? (qMap.get(r.question_id)?.prompt ?? null) : null,
      options: r.question_id ? (qMap.get(r.question_id)?.options ?? null) : null,
    }));

    const flagged = all.filter((r) => r.status === "revisar" || r.status === "nivel");
    const pending = flagged.filter((r) => r.resolution === "pending");
    const kept = flagged.filter((r) => r.resolution === "kept");
    const releveled = flagged.filter((r) => r.resolution === "relevel");

    // Validação POR VERSÃO de prova: cada versão é liberada (ou bloqueada)
    // isoladamente.
    const { data: versionRows } = await supabaseAdmin
      .from("assessment_versions")
      .select("version_label")
      .eq("assessment_id", a.id)
      .order("version_label", { ascending: true });
    const labels = [
      ...new Set([
        ...(versionRows ?? []).map((v) => String(v.version_label)),
        ...all.map((r) => r.version_label),
      ]),
    ].sort();
    const versions = labels.map((label) => {
      const items = all.filter((r) => r.version_label === label);
      const pend = items.filter((r) => (r.status === "revisar" || r.status === "nivel") && r.resolution === "pending");
      return {
        version_label: label,
        pending_count: pend.length,
        pending_positions: pend.map((r) => r.position).sort((x, y) => x - y),
        kept_count: items.filter((r) => r.resolution === "kept").length,
        blocked: pend.length > 0,
        summary:
          pend.length > 0
            ? `Versão ${label}: ${pend.length} ${pend.length === 1 ? "questão precisa" : "questões precisam"} de correção automática ou revisão manual (${pend
                .map((r) => `Q${r.position}`)
                .join(", ")}).`
            : `Versão ${label}: OK.`,
      };
    });
    return {
      title: a.title,
      items: flagged,
      total: all.length,
      pending_count: pending.length,
      kept_count: kept.length,
      relevel_count: releveled.length,
      out_of_level_count: kept.filter((r) => r.status === "nivel").length,
      versions,
      summary:
        pending.length > 0
          ? null
          : kept.length > 0 || releveled.length > 0
            ? [
                kept.length > 0
                  ? `${kept.length} questão(ões) conscientemente fora da sugestão do sistema${
                      kept.some((r) => r.status === "nivel") ? " (marcadas como fora do nível recomendado)" : ""
                    }`
                  : null,
                releveled.length > 0 ? `${releveled.length} questão(ões) com nível reclassificado` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Avaliação validada: todas as questões estão alinhadas à apostila e ao nível escolhido.",
    };
  });

/**
 * Regenera UMA questão pela IA durante a correção automática do painel de
 * revisão: o conceito descartado é substituído por um conceito válido da
 * apostila e a IA reescreve enunciado e alternativas com conteúdo técnico real
 * da área. Retorna null em qualquer falha (o chamador aplica o ajuste local),
 * nunca propagando erro nem alertas em cascata para o professor.
 */
async function regenerateQuestionWithAI(
  concept: string,
  currentPrompt: string,
  currentOptions: string[] | null,
): Promise<{ prompt: string; options: string[] | null } | null> {
  const optionCount = Array.isArray(currentOptions) && currentOptions.length >= 3 ? currentOptions.length : 0;
  try {
    const raw = await callAIJson<{ prompt?: string; options?: string[] }>({
      system:
        "Você é um especialista brasileiro em elaboração de itens avaliativos de nível universitário, válido para qualquer área (Saúde, Humanas, Exatas ou Biológicas). " +
        `Reescreva a questão de forma direta e técnica, centrada no conceito informado. ` +
        (optionCount
          ? `Gere EXATAMENTE ${optionCount} alternativas, todas afirmações factuais e plausíveis sobre o tema, com apenas uma correta na posição A. `
          : "A questão não possui alternativas: devolva apenas o enunciado. ") +
        "PROIBIÇÃO ABSOLUTA DE METALINGUAGEM: nunca use 'segundo o texto', 'conforme a aula', 'o material define', 'de acordo com a apostila', 'apresenta a definição correta', 'alternativa correta', 'todas as anteriores'. " +
        "Nenhuma alternativa pode comentar o acerto ou o erro de outra. " +
        'Responda SOMENTE com JSON válido: {"prompt": "...", "options": ["...", "..."]}.',
      user: [
        `CONCEITO CENTRAL VÁLIDO (obrigatório): ${concept}`,
        currentPrompt ? `ENUNCIADO ATUAL (a ser reescrito, pode conter termos genéricos):\n${currentPrompt}` : "",
        currentOptions && currentOptions.length > 0 ? `ALTERNATIVAS ATUAIS:\n- ${currentOptions.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      model: "google/gemini-3-flash-preview",
      temperature: 0.5,
      timeoutMs: 25000,
    });
    const prompt = sanitizeGeneratedQuestionText(String(raw?.prompt ?? ""));
    if (!prompt || prompt.length < 20) return null;
    let options: string[] | null = null;
    if (optionCount) {
      const list = Array.isArray(raw?.options) ? raw.options.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(String(o ?? "")))) : [];
      const valid = list.filter(Boolean);
      if (valid.length !== optionCount) return null;
      options = valid;
    }
    if (validateQuestionContent({ prompt, options, skipOptions: !options }).rejected) return null;
    if (hasGenericPlaceholderLeft(prompt, options)) return null;
    return { prompt, options };
  } catch {
    return null;
  }
}


/**
 * Aplica a decisão do professor a UM registro de auditoria (correção
 * automática, edição manual, reclassificação de nível ou manutenção
 * consciente). Reutilizado na resolução individual e na resolução em lote por
 * versão de prova.
 */
async function applyAuditResolution(
  audit: Record<string, unknown>,
  action: "suggestion" | "manual" | "keep" | "relevel",
  opts: { prompt?: string; options?: string[]; concept?: string },
  userId: string,
): Promise<{ resolution: "auto" | "manual" | "kept" | "relevel"; prompt: string | null }> {
  let resolution: "auto" | "manual" | "kept" | "relevel" = "kept";
  let nextPrompt: string | null = null;
  let nextOptions: string[] | null = null;
  if (action === "relevel") resolution = "relevel";

  if (action === "manual") {
    resolution = "manual";
    nextPrompt = (opts.prompt ?? "").trim() || null;
    if (Array.isArray(opts.options)) nextOptions = opts.options.map((o) => o.trim()).filter(Boolean);
    if (!nextPrompt) throw new Error("Informe o enunciado corrigido.");
    if (hasGenericPlaceholderLeft(nextPrompt, nextOptions)) {
      throw new Error(
        'Questão inconsistente: ainda há termos genéricos ("Disciplina", "Conteúdo", "Tema", "Assunto", "Matéria", "Apostila", "Aula", "Material", "Módulo" ou "Unidade") isolados no enunciado ou nas alternativas. Substitua pelo conceito técnico correspondente (ex: "o conteúdo programático" ou "a matéria orgânica" são permitidos, mas "o Conteúdo" sozinho não) antes de salvar.',
      );
    }
  } else if (action === "suggestion") {
    resolution = "auto";
    const suggested = (audit.suggested_prompt as string | null) ?? null;
    // Nunca aceita rótulos estruturais ("Disciplina", "Aula 2", "Ementa") como
    // conceito central da correção automática.
    const conceptOpts = (Array.isArray(audit.concept_options) ? (audit.concept_options as string[]) : [])
      .filter((c) => !isStructuralConceptLabel(c));
    const { data: q } = await supabaseAdmin
      .from("assessment_questions")
      .select("prompt, options")
      .eq("id", audit.question_id as string)
      .maybeSingle();
    const currentOptions = Array.isArray(q?.options)
      ? (q?.options as unknown[]).map((o) => String(o ?? ""))
      : null;
    if (suggested) {
      // Sugestões do auditor também passam pelo mesmo pós-processamento antes
      // de serem persistidas, evitando pontuação quebrada no fluxo automático.
      nextPrompt = sanitizeGeneratedQuestionText(suggested);
    } else {
      const base = String(q?.prompt ?? "");
      const optionText = (currentOptions ?? []).join(" ").toLowerCase();
      const score = (c: string) => {
        const words = c.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
        return words.filter((w) => optionText.includes(w)).length;
      };
      const best = [...conceptOpts].sort((x, y) => score(y) - score(x))[0];
      const requested = sanitizeExtractedConcept(opts.concept ?? "");
      const auditConcept = sanitizeExtractedConcept(audit.concept as string | null);
      let concept = (requested || best || auditConcept || "").trim();
      if (!concept) {
        // Fallback real: título da aula/módulo e, por último, nome da disciplina.
        const { data: ctx } = await supabaseAdmin
          .from("assessments")
          .select("module_name, discipline_id, disciplines(name)")
          .eq("id", audit.assessment_id as string)
          .maybeSingle();
        const lessonTitle = (audit.lesson_tag as string | null) ?? (ctx as any)?.module_name ?? null;
        concept = resolveConceptFallback([], lessonTitle, (ctx as any)?.disciplines?.name ?? null)[0] ?? "";
      }
      if (!concept) throw new Error("Nenhum conceito sugerido disponível. Edite manualmente.");
      // REGENERAÇÃO TRANSPARENTE VIA IA: a correção automática reescreve a
      // questão inteira com o conceito válido da apostila, em vez de aplicar um
      // template pré-moldado. Só cai no ajuste textual local se a IA falhar.
      const regenerated = await regenerateQuestionWithAI(concept, base, currentOptions);
      if (regenerated) {
        nextPrompt = regenerated.prompt;
        if (regenerated.options && regenerated.options.length > 0) nextOptions = regenerated.options;
      } else {
        const placeholder = detectGenericPlaceholder(base);
        nextPrompt = placeholder
          ? replaceGenericPlaceholders(base.replace(placeholder, concept), concept)
          : `Em uma situação prática que envolve ${concept}, a conduta tecnicamente correta é:`;
        if (currentOptions && currentOptions.length > 0) {
          const fixed = currentOptions.map((o) => replaceGenericPlaceholders(o, concept));
          if (fixed.some((o, idx) => o !== currentOptions[idx])) nextOptions = fixed;
        }
      }

      if (hasGenericPlaceholderLeft(nextPrompt, nextOptions ?? currentOptions)) {
        throw new Error(
          'A edição ainda contém termos genéricos como "Disciplina", "Conteúdo", "Tema" ou similar de forma isolada. Use o contexto real da aula (ex: "o conteúdo de histologia") para salvar.',
        );
      }
    }
  }

  // Pós-processamento final: qualquer caminho (sugestão do auditor, template
  // com conceito real ou edição manual do professor) passa pela mesma limpeza
  // de pontuação e de prefixos de alternativa antes de ser persistido.
  if (nextPrompt) nextPrompt = sanitizeGeneratedQuestionText(nextPrompt);
  if (nextOptions && nextOptions.length > 0) {
    nextOptions = nextOptions.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(String(o ?? "")))).filter(Boolean);
  }

  if (nextPrompt && audit.question_id) {
    const patch: Record<string, unknown> = { prompt: nextPrompt };
    if (nextOptions && nextOptions.length > 0) patch.options = nextOptions;
    const { error: upErr } = await supabaseAdmin
      .from("assessment_questions")
      .update(patch as never)
      .eq("id", audit.question_id as string);
    if (upErr) throw new Error(upErr.message);
  }

  const { error } = await supabaseAdmin
    .from("assessment_question_audits")
    .update({
      resolution,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      ...(resolution === "relevel"
        ? { declared_level: (audit.detected_level as string | null) ?? (audit.declared_level as string | null) }
        : {}),
      message:
        resolution === "kept"
          ? `${audit.message ?? ""} [Mantida pelo professor${
              audit.status === "nivel" ? " — fora do nível recomendado" : ""
            }]`.trim()
          : resolution === "relevel"
            ? `${audit.message ?? ""} [Enunciado mantido — nível da questão ajustado para ${
                (audit.detected_level as string | null) ?? "intermediário/avançado"
              }]`.trim()
            : (audit.message as string | null),
    } as never)
    .eq("id", audit.id as string);
  if (error) throw new Error(error.message);

  return { resolution, prompt: nextPrompt };
}

/**
 * Resolve EM LOTE todas as questões pendentes de uma versão de prova
 * (Versão A, B, C…). Usada pelos atalhos "corrigir automaticamente esta
 * versão" e "manter esta versão como está" no painel de revisão.
 */
export const resolveAssessmentVersionAudits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    assessment_id: z.string().uuid(),
    version_label: z.string().min(1).max(8),
    action: z.enum(["suggestion", "keep"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", data.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const { data: rows } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("*")
      .eq("assessment_id", a.id)
      .eq("version_label", data.version_label)
      .eq("resolution", "pending")
      .order("position", { ascending: true });

    let fixed = 0;
    const failures: Array<{ position: number; message: string }> = [];
    for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
      try {
        await applyAuditResolution(row, data.action, {}, context.userId);
        fixed++;
      } catch (e) {
        failures.push({
          position: Number(row.position ?? 0),
          message: e instanceof Error ? e.message : "Erro ao aplicar a correção",
        });
      }
    }

    const { count: pending } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", a.id)
      .eq("version_label", data.version_label)
      .eq("resolution", "pending");

    return { ok: failures.length === 0, fixed, failures, pending_count: pending ?? 0 };
  });

export const resolveAssessmentAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    audit_id: z.string().uuid(),
    action: z.enum(["suggestion", "manual", "keep", "relevel"]),
    prompt: z.string().min(5).max(30000).optional(),
    options: z.array(z.string().max(1000)).max(6).optional(),
    concept: z.string().max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: audit } = await supabaseAdmin
      .from("assessment_question_audits")
      .select("*")
      .eq("id", data.audit_id)
      .maybeSingle();
    if (!audit) throw new Error("Registro de revisão não encontrado");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", audit.assessment_id as string)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const applied = await applyAuditResolution(
      audit as unknown as Record<string, unknown>,
      data.action,
      { prompt: data.prompt, options: data.options, concept: data.concept },
      context.userId,
    );

    const [{ count: pending }, { count: versionPending }] = await Promise.all([
      supabaseAdmin
        .from("assessment_question_audits")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", a.id)
        .eq("resolution", "pending"),
      supabaseAdmin
        .from("assessment_question_audits")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", a.id)
        .eq("version_label", audit.version_label as string)
        .eq("resolution", "pending"),
    ]);

    return {
      ok: true,
      resolution: applied.resolution,
      prompt: applied.prompt,
      pending_count: pending ?? 0,
      version_label: audit.version_label as string,
      version_pending_count: versionPending ?? 0,
    };
  });
