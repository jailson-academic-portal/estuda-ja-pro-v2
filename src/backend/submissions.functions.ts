import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { callAIJson, callAIText } from "./ai.server";
import { notifyUsers } from "./notifications.server";
import { extractTextFromFile } from "./submission-extract.server";
import {
  flattenDiaryAssessmentOptions,
  isLaunchableDiaryAssessmentId,
  type DiaryAssessmentSource,
} from "@/lib/diary-assessments";

/* ---------- Common types ---------- */

const KindSchema = z.enum(["activity", "work"]);
type Kind = z.infer<typeof KindSchema>;

const RubricCriterion = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(30000).optional(),
  weight: z.number().min(0).max(100),
  max_score: z.number().min(0.1).max(100).default(10),
});
const RubricScore = z.object({
  id: z.string(),
  score: z.number().min(0).max(100),
  comment: z.string().max(30000).optional(),
});

function tableName(kind: Kind) {
  return kind === "activity" ? "activity_submissions" : "academic_work_submissions";
}
function parentTable(kind: Kind) {
  return kind === "activity" ? "activities" : "academic_works";
}
function fkColumn(kind: Kind) {
  return kind === "activity" ? "activity_id" : "work_id";
}

async function loadSubmissionWithParent(kind: Kind, submissionId: string) {
  const parent = parentTable(kind);
  const fk = fkColumn(kind);
  const { data, error } = await supabaseAdmin
    .from(tableName(kind))
    .select(`*, submitted_at, released_at, parent:${parent}!inner(id, discipline_id, title, rubric, instructions, diary_assessment_id, due_at, due_time, allow_late, late_penalty_per_day, late_penalty_type)`)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Entrega não encontrada");
  // normalize fk presence
  const fkValue = (data as Record<string, unknown>)[fk];
  if (!fkValue) throw new Error("Entrega inválida");
  return data as unknown as {
    id: string;
    student_id: string;
    file_url: string;
    status: string;
    submitted_at: string | null;
    released_at: string | null;
    rubric_snapshot: unknown;
    ai_usage_report: unknown;
    ai_feedback_draft: string | null;
    final_feedback: string | null;
    final_score: number | null;
    rubric_scores: unknown;
    diary_assessment_id: string | null;
    parent: {
      id: string;
      discipline_id: string;
      title: string;
      rubric: unknown;
      instructions: string | null;
      diary_assessment_id: string | null;
      due_at: string | null;
      due_time: string | null;
      allow_late: boolean | null;
      late_penalty_per_day: number | null;
      late_penalty_type: string | null;
    };
  };
}

/**
 * Calcula o desconto por atraso sobre a nota final da rubrica, usando os campos
 * de prazo/penalidade já existentes no pai (academic_works/activities).
 * Regra: dias de atraso = ceil((submitted_at - (due_at + due_time)) / 1 dia).
 * Penalidade por dia = late_penalty_per_day (padrão 0,5 quando não configurado).
 * Tipo 'fixed' desconta pontos por dia; 'percentage' desconta % da nota por dia.
 * A nota nunca fica abaixo de 0.
 */
function computeLatePenalty(params: {
  baseScore: number;
  submittedAt: string | null;
  dueAt: string | null;
  dueTime: string | null;
  allowLate: boolean | null;
  penaltyPerDay: number | null;
  penaltyType: string | null;
}): {
  finalScore: number;
  lateDays: number;
  discount: number;
  penaltyPerDay: number;
  penaltyType: "percentage" | "fixed";
  applied: boolean;
} {
  const base = Number(params.baseScore) || 0;
  const noPenalty = {
    finalScore: Number(base.toFixed(2)),
    lateDays: 0,
    discount: 0,
    penaltyPerDay: 0,
    penaltyType: "percentage" as const,
    applied: false,
  };
  if (!params.allowLate) return noPenalty;
  if (!params.dueAt || !params.submittedAt) return noPenalty;

  // Monta o instante-limite combinando a data (due_at) com o horário (due_time).
  const dueDatePart = params.dueAt.split("T")[0] ?? params.dueAt;
  const dueTimePart = (params.dueTime ?? "23:59:59").slice(0, 8) || "23:59:59";
  const dueInstant = new Date(`${dueDatePart}T${dueTimePart}`);
  const submittedInstant = new Date(params.submittedAt);
  if (Number.isNaN(dueInstant.getTime()) || Number.isNaN(submittedInstant.getTime())) return noPenalty;

  const diffMs = submittedInstant.getTime() - dueInstant.getTime();
  if (diffMs <= 0) return noPenalty;

  const lateDays = Math.ceil(diffMs / 86_400_000);
  // Quando o professor configura um valor, respeitamos o valor e o tipo dele.
  // Quando o professor define explicitamente 0 (ou negativo), NÃO há desconto algum.
  // Somente quando nada foi informado (null/undefined) usamos o padrão de
  // 0,5 PONTO ABSOLUTO por dia (desconto fixo em pontos), não 0,5% da nota.
  if (params.penaltyPerDay != null && !(Number(params.penaltyPerDay) > 0)) return noPenalty;
  const hasConfiguredPenalty =
    params.penaltyPerDay != null && Number(params.penaltyPerDay) > 0;
  const penaltyPerDay = hasConfiguredPenalty ? Number(params.penaltyPerDay) : 0.5;
  // O tipo de penalidade pode chegar como "fixed" ou "points" (ambos = desconto
  // absoluto em pontos por dia). Qualquer outro valor cai como percentual.
  const isFixedType =
    params.penaltyType === "fixed" || params.penaltyType === "points";
  const penaltyType: "percentage" | "fixed" = hasConfiguredPenalty
    ? isFixedType
      ? "fixed"
      : "percentage"
    : "fixed";


  const rawDiscount =
    penaltyType === "fixed"
      ? penaltyPerDay * lateDays
      : base * (penaltyPerDay / 100) * lateDays;
  const discount = Math.min(base, Math.max(0, Number(rawDiscount.toFixed(2))));
  const finalScore = Number(Math.max(0, base - discount).toFixed(2));
  return { finalScore, lateDays, discount, penaltyPerDay, penaltyType, applied: discount > 0 };
}

/** Loads identification context: submitter (+group members), discipline, teacher and institution names. */
async function loadIdentificationContext(sub: {
  id: string;
  student_id: string;
  parent: { id: string; discipline_id: string };
}, kind: Kind) {
  const [discRes, submitterRes, groupRes] = await Promise.all([
    supabaseAdmin
      .from("disciplines")
      .select("name, teacher_id, institution_id")
      .eq("id", sub.parent.discipline_id)
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("id,name,enrollment_number").eq("id", sub.student_id).maybeSingle(),
    supabaseAdmin
      .from("activity_groups")
      .select("leader_id, member_ids")
      .eq("discipline_id", sub.parent.discipline_id)
      .eq("activity_id", sub.parent.id)
      .eq("activity_kind", kind)
      .or(`leader_id.eq.${sub.student_id},member_ids.cs.{${sub.student_id}}`)
      .maybeSingle(),
  ]);
  const disc = discRes.data as { name?: string; teacher_id?: string; institution_id?: string } | null;
  const [teacherRes, instRes] = await Promise.all([
    disc?.teacher_id
      ? supabaseAdmin.from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle()
      : Promise.resolve({ data: null }),
    disc?.institution_id
      ? supabaseAdmin.from("institutions").select("name").eq("id", disc.institution_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const submitter = submitterRes.data as { name?: string; enrollment_number?: string | null } | null;
  const memberIds = groupRes.data
    ? Array.from(new Set([
        (groupRes.data as { leader_id: string }).leader_id,
        ...(((groupRes.data as { member_ids?: string[] }).member_ids) ?? []),
      ])).filter(Boolean)
    : [];
  const groupProfs = memberIds.length
    ? (await supabaseAdmin.from("profiles").select("id,name").in("id", memberIds)).data ?? []
    : [];
  return {
    disciplineName: disc?.name ?? "(não informada)",
    teacherName: (teacherRes.data as { name?: string } | null)?.name ?? "(não informado)",
    institutionName: (instRes.data as { name?: string } | null)?.name ?? null,
    submitterName: submitter?.name ?? "(não informado)",
    submitterEnrollment: submitter?.enrollment_number ?? null,
    groupMemberNames: (groupProfs as Array<{ name: string }>).map((p) => p.name).filter(Boolean),
  };
}

/* ---------- Permitir Reenvio (Apagar submissão) ---------- */

export const deleteSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);

    const { error } = await supabaseAdmin
      .from(tableName(data.kind))
      .delete()
      .eq("id", data.submission_id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- List submissions (teacher) ---------- */

export const listSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      discipline_id: z.string().uuid(),
      activity_id: z.string().uuid().optional(),
      kind: KindSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    const parent = parentTable(data.kind);
    const fk = fkColumn(data.kind);
    
    let parentQuery = supabaseAdmin
      .from(parent)
      .select("id,title,diary_assessment_id")
      .eq("discipline_id", data.discipline_id);
      
    if (data.activity_id) {
      parentQuery = parentQuery.eq("id", data.activity_id);
    }
    
    const { data: parents } = await parentQuery;
    const parentIds = (parents ?? []).map((p) => p.id);
    if (!parentIds.length) return { submissions: [] };
    
    let subQuery = supabaseAdmin
      .from(tableName(data.kind))
      .select("*")
      .in(fk, parentIds);
      
    if (data.activity_id) {
      subQuery = subQuery.eq(fk as any, data.activity_id);
    }
    
    const { data: subs } = await subQuery.order("submitted_at", { ascending: false });
    const studentIds = Array.from(new Set((subs ?? []).map((s) => s.student_id)));
    const { data: profs } = studentIds.length
      ? await supabaseAdmin.from("profiles").select("id,name,enrollment_number").in("id", studentIds)
      : { data: [] as Array<{ id: string; name: string; enrollment_number: string | null }> };
    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const parentMap = new Map((parents ?? []).map((p) => [p.id, p]));
    return {
      submissions: (subs ?? []).map((s) => {
        const row = s as Record<string, any>;
        const parent = parentMap.get(row[fk]);
        return {
          ...row,
          student_name: profMap.get(row.student_id)?.name ?? "Aluno",
          enrollment_number: profMap.get(row.student_id)?.enrollment_number ?? null,
          parent_id: row[fk],
          parent_title: parent?.title ?? "",
          parent_diary_assessment_id: parent?.diary_assessment_id ?? null,
        };
      }),
    };
  });

/* ---------- Download URL (signed) ---------- */

const KNOWN_BUCKETS = new Set(["submissions", "materials", "syllabi", "justifications"]);

function bucketForFile(fileUrl: string): { bucket: string; path: string } {
  // Files are uploaded to the "submissions" bucket with path "<userId>/<disciplineId>/...".
  // Older records may have included the bucket name as the first segment.
  const m = fileUrl.match(/^([^/]+)\/(.+)$/);
  if (m && KNOWN_BUCKETS.has(m[1])) return { bucket: m[1], path: m[2] };
  return { bucket: "submissions", path: fileUrl };
}

export const getSubmissionDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    const isOwner = sub.student_id === context.userId;
    if (!isOwner) await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    // If file_url looks like a full URL, return it directly
    const fileUrl = (sub as unknown as { file_url: string }).file_url;
    if (/^https?:\/\//i.test(fileUrl)) return { url: fileUrl };
    const parsed = bucketForFile(fileUrl);
    const { data: signed, error } = await supabaseAdmin.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/* ---------- Extract text from submitted file ---------- */

export const extractSubmissionText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    const rawSub = sub as unknown as {
      file_url: string;
      submission_text?: string | null;
      attachments?: { answers?: Record<string, string>; questions?: string[] };
    };
    const fileUrl = rawSub.file_url;

    // Prefer the text saved at submission time (ABNT editor / inline answers).
    const stored = (rawSub.submission_text ?? "").trim();
    if (stored.length > 20) return { text: stored };
    
    
    // If it's an interactive submission, reconstruct the text from answers
    if (fileUrl === "inline_submission" && rawSub.attachments?.answers) {
      const answers = rawSub.attachments.answers;
      const questions = rawSub.attachments.questions || [];
      const reconstructed = Object.entries(answers)
        .map(([idx, text]) => {
          const qText = questions[parseInt(idx)] || `Questão ${parseInt(idx) + 1}`;
          return `Questão: ${qText}\nResposta: ${text}\n`;
        })
        .join("\n");
      return { text: reconstructed };
    }

    try {
      const text = await extractTextFromFile(fileUrl);
      if ((text ?? "").trim()) return { text };
    } catch (e) {
      if (!stored) throw e;
    }
    if (stored) return { text: stored };
    return { text: "" };
  });

/* ---------- AI Usage Analysis (informativa) ---------- */

export const analyzeAIUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
      submission_text: z.string().min(1).max(80000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    const report = await callAIJson<{
      score: number;
      level: "baixo" | "medio" | "alto";
      indicators: string[];
      summary: string;
      content_summary?: string;
      key_points?: string[];
      evidence?: string[];
    }>({
      system:
        "Você é um analisador acadêmico que: (1) estima a probabilidade de um texto ter sido gerado por IA (informativa, nunca decisória — uso de IA como apoio é legítimo; sinalize apenas indícios de cópia integral sem elaboração própria); (2) resume o conteúdo do trabalho do aluno para apoiar a correção subsequente. Responda SEMPRE em JSON válido em pt-BR com as chaves: score (0-100), level ('baixo'|'medio'|'alto'), indicators (array de strings curtas — pistas de uso de IA), evidence (array de trechos/observações que sustentam o score de IA), summary (resumo curto da análise de IA), content_summary (resumo objetivo do que o aluno escreveu, 4-8 frases), key_points (array com os principais pontos abordados pelo aluno).",
      user: `Analise o texto abaixo. Retorne JSON com score, level, indicators, evidence, summary, content_summary e key_points.\n\nTEXTO:\n${data.submission_text.slice(0, 60000)}`,
    });
    const normalized = {
      score: Math.max(0, Math.min(100, Number(report.score) || 0)),
      level: (["baixo", "medio", "alto"].includes(report.level) ? report.level : "baixo") as "baixo" | "medio" | "alto",
      indicators: Array.isArray(report.indicators) ? report.indicators.slice(0, 10).map(String) : [],
      summary: String(report.summary ?? ""),
      content_summary: String(report.content_summary ?? ""),
      key_points: Array.isArray(report.key_points) ? report.key_points.slice(0, 12).map(String) : [],
      evidence: Array.isArray(report.evidence) ? report.evidence.slice(0, 10).map(String) : [],
      analyzed_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from(tableName(data.kind))
      .update({ ai_usage_report: normalized as never })
      .eq("id", data.submission_id);
    if (error) throw new Error(error.message);
    return normalized;
  });

/* ---------- Suggest rubric scores + comments via AI ---------- */

export const suggestRubricScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
      submission_text: z.string().min(1).max(80000),
      rubric: z.array(RubricCriterion).min(1).max(30),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    const aiReport = (sub.ai_usage_report ?? null) as {
      content_summary?: string;
      key_points?: string[];
    } | null;
    const ident = await loadIdentificationContext(sub, data.kind);
    const disciplineName = ident.disciplineName;
    const expectedAuthors = [ident.submitterName, ...ident.groupMemberNames].filter(Boolean);
    // Cabeçalho formal/ABNT só é exigido em Trabalhos Acadêmicos enviados por ARQUIVO anexo.
    // Respostas feitas na plataforma (atividades extras, estudos de caso, dissertativas) já
    // têm identificação sistêmica do aluno logado.
    const isInlineSubmission = (sub as unknown as { file_url?: string }).file_url === "inline_submission";
    const requiresFormalHeader = data.kind === "work" && !isInlineSubmission;
    const result = await callAIJson<{ scores: Array<{ id: string; score: number; comment: string }> }>({
      system:
        [
          "Você é um(a) professor(a) universitário(a) rigoroso(a) e imparcial corrigindo uma entrega acadêmica.",
          "ESTRUTURA DE RESPOSTA: Se o trabalho for um Estudo de Caso Interativo com múltiplas questões direcionadas, avalie cada questão individualmente e use a soma para os critérios de conteúdo e fundamentação.",
          "FALLBACK DE SEGURANÇA: Se a resposta do aluno estiver ilegível, totalmente fora de contexto ou incompleta ao ponto de impossibilitar a avaliação, responda com uma devolutiva orientação pedagógica solicitando a reentrega, sem inventar nota ou alucinar critérios.",
          "REGRAS OBRIGATÓRIAS de avaliação:",
          "1) Avalie SOMENTE o texto real do aluno abaixo. NÃO invente conteúdo, exemplos, seções ou trechos que não estejam presentes.",
          "2) VERIFIQUE ADERÊNCIA AO ENUNCIADO: o texto deve tratar do tema/disciplina descritos nas Instruções. Se o trabalho fugir do tema, tratar de disciplina diferente, ou não mencionar o objeto pedido no enunciado, penalize fortemente TODOS os critérios pertinentes (especialmente 'Análise', 'Fundamentação' e 'Estrutura') e explique no comentário.",
          requiresFormalHeader
            ? "3) Para o critério 'Estrutura e Clareza' (ou equivalente), analise objetivamente: presença de introdução/desenvolvimento/conclusão, títulos/subtítulos, parágrafos coesos, uso de listas/tabelas quando aplicável, ortografia, coerência, e — quando cabível — normas ABNT. Um texto curto, sem seções, sem título/tema explícito, ou desorganizado NÃO pode receber nota alta (>7)."
            : "3) Para o critério 'Estrutura e Clareza' (ou equivalente), avalie APENAS a organização das ideias, coesão, coerência, clareza da argumentação e ortografia. NÃO avalie formatação ABNT, capa, título ou seções formais — a resposta foi escrita diretamente na plataforma.",
          "4) Nunca dê a nota máxima 'por padrão'. Notas altas exigem evidência concreta citada no comentário (mencione trechos, seções ou aspectos observados).",
          "5) Se o texto do aluno estiver vazio, ilegível, truncado ou for muito curto para julgar, atribua nota baixa e explique.",
          requiresFormalHeader
            ? "6) VERIFICAÇÃO DE IDENTIFICAÇÃO OBRIGATÓRIA: o arquivo enviado DEVE conter cabeçalho de identificação com (a) Instituição de ensino (nome ou logo), (b) Disciplina, (c) Nome do Professor, (d) Tema/Título do trabalho e (e) Nome completo do(s) aluno(s). Compare os nomes de aluno(s) declarados no texto com os nomes esperados. Se ausente ou incorreto, PENALIZE fortemente o critério 'Estrutura e Clareza' (ou equivalente) e cite explicitamente no comentário."
            : "6) PROIBIDO avaliar identificação/cabeçalho: esta entrega foi respondida diretamente no sistema, que já identifica automaticamente o aluno logado. NÃO exija nem desconte nota por ausência de instituição, disciplina, professor, matrícula, capa ou título no corpo da resposta, e não mencione isso no comentário. Avalie 100% o mérito técnico e pedagógico: precisão dos conceitos teóricos, resolução do problema/estudo de caso e clareza da argumentação com fundamentação científica.",
          "7) Para CADA critério retorne: id (exatamente o id recebido), score (0 a max_score, com até 2 casas decimais) e comment (pt-BR, 2-5 frases, com pontos positivos, deficiências e a justificativa da nota, citando evidências do texto).",
          "8) INDEPENDÊNCIA ABSOLUTA DOS CRITÉRIOS (REGRA DOS 5 CRITÉRIOS ISOLADOS - INVIOLÁVEL): avalie cada um dos 5 critérios da rubrica de forma TOTALMENTE ISOLADA. Erros de formatação, falta de capa, gramática, erros de citação ou normas ABNT devem descontar pontos EXCLUSIVAMENTE no critério focado em 'Estrutura e Linguagem' (ou equivalente estrutural).",
          "9) BLINDAGEM DE CONTEÚDO: É TERMINANTEMENTE PROIBIDO penalizar os critérios de conteúdo ('Compreensão do Tema', 'Desenvolvimento', 'Fundamentação', 'Originalidade/Análise Crítica' ou similares) devido a falhas de ABNT, de formatação ou de idioma. Se as ideias e a fundamentação teórica existirem no texto e forem excelentes, atribua a nota MÁXIMA nesses critérios de conteúdo, independentemente do aluno ter errado a ABNT ou não ter referências formatadas. Nos comentários dos critérios de conteúdo, NUNCA mencione nem critique a falta de ABNT ou de formatação — reserve 100% dessas críticas pontuais para o comentário de Estrutura.",
          "Responda APENAS em JSON válido com a chave 'scores' (array). Não invente critérios; use apenas os ids fornecidos.",

        ].join(" "),
      user:
        `[CONTEXTO DA DISCIPLINA]\n` +
        `INSTITUIÇÃO: ${ident.institutionName ?? "(professor autônomo)"}\n` +
        `DISCIPLINA: ${disciplineName}\n` +
        `PROFESSOR(A): ${ident.teacherName}\n` +
        (requiresFormalHeader
          ? `ALUNO(S) REMETENTE(S) ESPERADO(S) NO CABEÇALHO: ${expectedAuthors.join(", ") || "(desconhecido)"}\n`
          : `ALUNO(S) IDENTIFICADO(S) PELO SISTEMA (não exigir no texto): ${expectedAuthors.join(", ") || "(desconhecido)"}\n`) +
        `TÍTULO DA ATIVIDADE: ${sub.parent.title}\n\n` +
        `[ENUNCIADO E CRITÉRIOS DO PROFESSOR]\n` +
        `INSTRUÇÕES/ENUNCIADO ORIGINAL (use para verificar aderência de tema e disciplina e detectar se há questões direcionadas):\n${(sub.parent.instructions ?? "(sem instruções)").slice(0, 8000)}\n\n` +
        `RUBRICA (JSON — respeite ids e max_score):\n${JSON.stringify(data.rubric)}\n\n` +
        `RESUMO DO CONTEÚDO DO ALUNO (referência auxiliar, passo 1):\n${aiReport?.content_summary ?? "(sem resumo)"}\n\n` +
        `PONTOS-CHAVE (auxiliar):\n${(aiReport?.key_points ?? []).join("; ") || "(n/a)"}\n\n` +
        `[RESPOSTA SUBMETIDA PELO ESTUDANTE]\n` +
        `TEXTO REAL DO ALUNO (fonte primária da avaliação — se houver Questão 1, Questão 2... avalie individualmente):\n${data.submission_text.slice(0, 45000)}`,
    });
    const byId = new Map(data.rubric.map((c) => [c.id, c]));
    const normalized = (result.scores ?? [])
      .filter((s) => s && byId.has(String(s.id)))
      .map((s) => {
        const crit = byId.get(String(s.id))!;
        const raw = Number(s.score);
        const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(crit.max_score, raw)) : 0;
        return { id: crit.id, score: Number(clamped.toFixed(2)), comment: String(s.comment ?? "").trim() };
      });
    return { scores: normalized };
  });

/* ---------- AI Feedback Generation ---------- */

export const generateFeedbackDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
      submission_text: z.string().min(1).max(80000),
      rubric: z.array(RubricCriterion).min(1).max(30),
      rubric_scores: z.array(RubricScore).default([]),
      final_score: z.number().min(0).max(100).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    const aiReport = sub.ai_usage_report as {
      level?: string;
      summary?: string;
      content_summary?: string;
      key_points?: string[];
    } | null;
    const ethicalNote = aiReport && aiReport.level && aiReport.level !== "baixo"
      ? "Inclua ao final um parágrafo orientando o(a) aluno(a) sobre o uso ético e responsável da IA como ferramenta de apoio (não substitui elaboração própria), de forma educativa e não punitiva."
      : "Use linguagem encorajadora e construtiva.";
    const ident = await loadIdentificationContext(sub, data.kind);
    const disciplineName = ident.disciplineName;
    const expectedAuthors = [ident.submitterName, ...ident.groupMemberNames].filter(Boolean);
    const isInlineSubmission = (sub as unknown as { file_url?: string }).file_url === "inline_submission";
    const requiresFormalHeader = data.kind === "work" && !isInlineSubmission;

    const penalty = computeLatePenalty({
      baseScore: data.final_score ?? 0,
      submittedAt: sub.submitted_at,
      dueAt: sub.parent.due_at,
      dueTime: sub.parent.due_time,
      allowLate: sub.parent.allow_late,
      penaltyPerDay: sub.parent.late_penalty_per_day,
      penaltyType: sub.parent.late_penalty_type,
    });

    const lateNote = penalty.applied
      ? `ATENÇÃO - ENTREGA EM ATRASO: Esta atividade foi entregue com ${penalty.lateDays} dia(s) de atraso. É OBRIGATÓRIO incluir uma seção ou menção explícita no feedback sobre o atraso na entrega e o desconto aplicado de ${penalty.discount} ponto(s) (nota antes do desconto: ${data.final_score ?? 0}, nota final após desconto: ${penalty.finalScore}).`
      : "";

    let feedback = await callAIText({
      system:
        [
          "Você é um(a) professor(a) universitário(a) preparando feedback acadêmico personalizado, honesto e coerente com as notas atribuídas.",
          "REGRAS OBRIGATÓRIAS:",
          "1) Baseie-se APENAS no texto real do aluno, na rubrica e nas notas fornecidas. NUNCA invente tema, disciplina, seções, exemplos ou conteúdos ausentes do texto.",
          "2) Use SEMPRE a Disciplina e o Título fornecidos abaixo — não substitua por outros temas/disciplinas.",
          "3) Se o texto do aluno não trata do tema/disciplina do enunciado (ou está vazio/muito curto), diga isso explicitamente na Abertura e na Avaliação geral, de forma respeitosa.",
          "4) O feedback deve ser COERENTE com as notas: notas baixas exigem apontar deficiências concretas; notas altas exigem citar evidências reais observadas no texto.",
          requiresFormalHeader
            ? "5) Para 'Estrutura e Clareza' analise objetivamente presença de introdução/desenvolvimento/conclusão, títulos, coesão, ortografia e — quando cabível — ABNT. Não elogie estrutura que não existe."
            : "5) Para 'Estrutura e Clareza' analise apenas organização das ideias, coesão, coerência e ortografia. NÃO cobre formatação ABNT, capa ou seções formais — a resposta foi escrita diretamente na plataforma.",
          requiresFormalHeader
            ? "6) VERIFIQUE OBRIGATORIAMENTE o cabeçalho de identificação do trabalho: (a) Instituição (nome ou logo), (b) Disciplina, (c) Nome do Professor, (d) Tema/Título e (e) Nome completo do(s) aluno(s). Compare o(s) nome(s) do(s) autor(es) declarado(s) no texto com o(s) nome(s) esperado(s) do remetente/grupo. Se houver DIVERGÊNCIA de autoria ou item ausente/incorreto, inclua uma seção **Identificação do trabalho** logo após a Abertura descrevendo o(s) problema(s) e reforce a orientação de correção."
            : "6) PROIBIDO comentar identificação/cabeçalho: o sistema já identifica automaticamente o aluno logado. NUNCA crie a seção 'Identificação do trabalho', não exija nem penalize ausência de instituição, disciplina, professor, matrícula ou título no corpo da resposta. O feedback deve ser 100% focado no mérito técnico e pedagógico: precisão conceitual, resolução do problema/estudo de caso e clareza da argumentação com fundamentação científica.",
          "7) ISOLAMENTO DOS 5 CRITÉRIOS (BLINDAGEM DE CONTEÚDO): Ao elaborar a 'Análise por critério', garanta que suas críticas e elogios não se cruzem. Discuta problemas de formatação, capa, citações e ABNT EXCLUSIVAMENTE na análise de 'Estrutura e Linguagem'. Nunca mencione falhas ou falta de ABNT nos comentários de Compreensão, Desenvolvimento, Fundamentação ou Análise. Se o aluno errou a forma (ABNT) mas acertou os conceitos (Conteúdo), exalte o conteúdo na seção correspondente, livre de qualquer crítica sobre a formatação.",
          lateNote,
          "Escreva em pt-BR, tom respeitoso e construtivo, em Markdown com as seções: **Abertura**, **Análise por critério**, **Avaliação geral**, **Orientações para melhoria** e, quando pertinente, **Uso ético da IA**.",
        ].filter(Boolean).join(" "),
      user:
        `INSTITUIÇÃO: ${ident.institutionName ?? "(professor autônomo)"}\n` +
        `DISCIPLINA: ${disciplineName}\n` +
        `PROFESSOR(A): ${ident.teacherName}\n` +
        (requiresFormalHeader
          ? `ALUNO(S) REMETENTE(S) ESPERADO(S) NO CABEÇALHO: ${expectedAuthors.join(", ") || "(desconhecido)"}\n`
          : `ALUNO(S) IDENTIFICADO(S) PELO SISTEMA (não exigir no texto): ${expectedAuthors.join(", ") || "(desconhecido)"}\n`) +
        `TÍTULO DA ATIVIDADE: ${sub.parent.title}\n\n` +
        `INSTRUÇÕES/ENUNCIADO ORIGINAL:\n${(sub.parent.instructions ?? "(sem instruções)").slice(0, 6000)}\n\n` +
        `Resumo do conteúdo do aluno (passo 1, auxiliar):\n${aiReport?.content_summary ?? "(não disponível)"}\n\n` +
        `Pontos-chave identificados (auxiliar):\n${(aiReport?.key_points ?? []).join("; ") || "(n/a)"}\n\n` +
        `Rubrica aplicada (JSON):\n${JSON.stringify(data.rubric)}\n\n` +
        `Notas e comentários por critério (passo 2, JSON — respeite-as):\n${JSON.stringify(data.rubric_scores)}\n\n` +
        `Nota final da rubrica: ${data.final_score ?? "—"}\n` +
        (penalty.applied
          ? `INFORMAÇÕES DE ATRASO: Entregue em ${new Date(sub.submitted_at!).toLocaleString("pt-BR")}, prazo era ${new Date(`${sub.parent.due_at!.split("T")[0]}T${(sub.parent.due_time ?? "23:59:59").slice(0, 8)}`).toLocaleString("pt-BR")}. Dias de atraso: ${penalty.lateDays}. Desconto por atraso: ${penalty.discount} ponto(s). Nota calculada pós-desconto: ${penalty.finalScore}.\n`
          : "") +
        `\nAnálise de uso de IA (informativa):\n${JSON.stringify(aiReport ?? {})}\n\n` +
        `${ethicalNote}\n\n` +
        `TEXTO REAL DO ALUNO (fonte principal — cite trechos quando útil):\n${data.submission_text.slice(0, 45000)}`,
    });

    if (penalty.applied && !feedback.includes("Desconto por atraso") && !feedback.includes("atraso na entrega")) {
      const penaltyLine =
        penalty.penaltyType === "fixed"
          ? `${penalty.penaltyPerDay.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ponto(s) por dia`
          : `${penalty.penaltyPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% da nota por dia`;
      feedback =
        `${feedback}\n\n---\n\n**Desconto por atraso na entrega**\n\n` +
        `- Nota antes do desconto: ${(data.final_score ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `- Dias de atraso: ${penalty.lateDays}\n` +
        `- Penalidade aplicada: ${penaltyLine} (total −${penalty.discount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})\n` +
        `- **Nota final após o desconto: ${penalty.finalScore.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**`;
    }

    const { error } = await supabaseAdmin
      .from(tableName(data.kind))
      .update({ ai_feedback_draft: feedback } as never)
      .eq("id", data.submission_id);
    if (error) throw new Error(error.message);
    return { feedback };
  });

/* ---------- Save correction (draft) ---------- */

export const saveCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
      rubric_snapshot: z.array(RubricCriterion).min(1).max(30),
      rubric_scores: z.array(RubricScore).default([]),
      final_score: z.number().min(0).max(100),
      final_feedback: z.string().trim().min(1).max(30000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);

    // Aplica o desconto por atraso sobre a nota da rubrica (fonte da verdade).
    const penalty = computeLatePenalty({
      baseScore: data.final_score,
      submittedAt: sub.submitted_at,
      dueAt: sub.parent.due_at,
      dueTime: sub.parent.due_time,
      allowLate: sub.parent.allow_late,
      penaltyPerDay: sub.parent.late_penalty_per_day,
      penaltyType: sub.parent.late_penalty_type,
    });

    // Feedback ao aluno com o detalhamento do desconto, para evitar contestação.
    let finalFeedback = data.final_feedback;
    if (penalty.applied) {
      const penaltyLine =
        penalty.penaltyType === "fixed"
          ? `${penalty.penaltyPerDay.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} ponto(s) por dia`
          : `${penalty.penaltyPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% da nota por dia`;
      finalFeedback =
        `${data.final_feedback}\n\n---\n\n**Desconto por atraso na entrega**\n\n` +
        `- Nota antes do desconto: ${data.final_score.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `- Dias de atraso: ${penalty.lateDays}\n` +
        `- Penalidade aplicada: ${penaltyLine} (total −${penalty.discount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})\n` +
        `- **Nota final após o desconto: ${penalty.finalScore.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**`;
    }

    const { error } = await supabaseAdmin
      .from(tableName(data.kind))
      .update({
        rubric_snapshot: data.rubric_snapshot as never,
        rubric_scores: data.rubric_scores as never,
        final_score: penalty.finalScore,
        final_feedback: finalFeedback,
        total_score: penalty.finalScore,
        status: "corrected" as never,
      })
      .eq("id", data.submission_id);
    if (error) throw new Error(error.message);
    return { ok: true, late_penalty: penalty.applied ? penalty : null };
  });

/* ---------- List diary assessments ---------- */

export const listDiaryAssessments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      if (!context.userId) return { assessments: [], diary_assessments: [], grade_scale: 10, configured: false };
      await assertTeacherOrAdmin(data.discipline_id, context.userId);
      const { data: gs, error } = await supabaseAdmin
        .from("grade_structures")
        .select("assessments, grade_scale")
        .eq("discipline_id", data.discipline_id)
        .maybeSingle();
      
      if (error) {
        console.error("Error fetching grade_structures:", error);
        return { assessments: [], diary_assessments: [], grade_scale: 10, configured: false };
      }

      const assessments = (gs?.assessments as unknown as DiaryAssessmentSource[]) ?? [];
      return {
        assessments,
        diary_assessments: flattenDiaryAssessmentOptions(assessments),
        grade_scale: (gs?.grade_scale ?? 10) as number,
        configured: !!gs,
      };
    } catch (e) {
      console.error("Crash in listDiaryAssessments:", e);
      return { assessments: [], diary_assessments: [], grade_scale: 10, configured: false };
    }
  });

/* ---------- Publish correction → release + diary entry + notify ---------- */

export const publishCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
      diary_assessment_id: z.string().min(1).max(80),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);
    if (sub.final_score == null || !sub.final_feedback) {
      throw new Error("Salve a correção (nota e feedback) antes de publicar.");
    }
    // Validate assessment exists in this discipline's diary
    const { data: gs } = await supabaseAdmin
      .from("grade_structures")
      .select("assessments")
      .eq("discipline_id", sub.parent.discipline_id)
      .maybeSingle();
    const assessments = (gs?.assessments as unknown as DiaryAssessmentSource[]) ?? [];
    const parentConfiguredAssessmentId = sub.parent.diary_assessment_id;
    const requestedIsValid = isLaunchableDiaryAssessmentId(assessments, data.diary_assessment_id);
    const configuredIsValid = parentConfiguredAssessmentId
      ? isLaunchableDiaryAssessmentId(assessments, parentConfiguredAssessmentId)
      : false;
    const targetDiaryAssessmentId = requestedIsValid
      ? data.diary_assessment_id
      : configuredIsValid
        ? parentConfiguredAssessmentId
        : "";
    if (!targetDiaryAssessmentId) {
      throw new Error("Campo do diário inválido. Configure a estrutura de notas primeiro.");
    }
    // Upsert diary entry
    const { error: gradeError } = await supabaseAdmin
      .from("grade_entries")
      .upsert(
        {
          discipline_id: sub.parent.discipline_id,
          student_id: sub.student_id,
          assessment_id: targetDiaryAssessmentId,
          score: sub.final_score,
        },
        { onConflict: "discipline_id,student_id,assessment_id" },
      );
    if (gradeError) throw new Error(gradeError.message);
    // Mark submission as released
    const now = new Date().toISOString();
    const { error: subErr } = await supabaseAdmin
      .from(tableName(data.kind))
      .update({
        status: "released" as never,
        released_at: now,
        published_at: now,
        published_by: context.userId,
        diary_assessment_id: targetDiaryAssessmentId,
        teacher_comment: sub.final_feedback,
      })
      .eq("id", data.submission_id);
    if (subErr) throw new Error(subErr.message);
    // Propagate grade + feedback to group members (group delivery)
    const recipients = new Set<string>([sub.student_id]);
    const { data: group } = await supabaseAdmin
      .from("activity_groups")
      .select("leader_id, member_ids")
      .eq("discipline_id", sub.parent.discipline_id)
      .eq("activity_id", sub.parent.id)
      .eq("activity_kind", data.kind)
      .or(`leader_id.eq.${sub.student_id},member_ids.cs.{${sub.student_id}}`)
      .maybeSingle();
    if (group) {
      const memberIds = Array.from(
        new Set([group.leader_id, ...((group.member_ids as string[]) ?? [])]),
      ).filter((id) => id && id !== sub.student_id);
      for (const memberId of memberIds) {
        recipients.add(memberId);
        // Diary grade for each member
        await supabaseAdmin.from("grade_entries").upsert(
          {
            discipline_id: sub.parent.discipline_id,
            student_id: memberId,
            assessment_id: targetDiaryAssessmentId,
            score: sub.final_score,
          },
          { onConflict: "discipline_id,student_id,assessment_id" },
        );
        // Mirror the corrected submission so each member sees the same nota/feedback
        await supabaseAdmin.from(tableName(data.kind)).upsert(
          {
            [fkColumn(data.kind)]: sub.parent.id,
            student_id: memberId,
            file_url: sub.file_url,
            status: "released" as never,
            submitted_at: now,
            released_at: now,
            published_at: now,
            published_by: context.userId,
            diary_assessment_id: targetDiaryAssessmentId,
            total_score: sub.final_score,
            final_score: sub.final_score,
            final_feedback: sub.final_feedback,
            teacher_comment: sub.final_feedback,
            rubric_scores: sub.rubric_scores as never,
          } as never,
          { onConflict: `${fkColumn(data.kind)},student_id` },
        );
      }
    }
    // Notify student(s)
    await notifyUsers(
      Array.from(recipients),
      "feedback_available",
      data.kind === "activity" ? "Atividade corrigida" : "Trabalho corrigido",
      `${sub.parent.title} — nota e feedback disponíveis.`,
      `/disciplines/${sub.parent.discipline_id}`,
    );
    return { ok: true };
  });

/* ---------- Export Feedback PDF ---------- */

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export const exportFeedbackPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submission_id: z.string().uuid(),
      kind: KindSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sub = await loadSubmissionWithParent(data.kind, data.submission_id);
    await assertTeacherOrAdmin(sub.parent.discipline_id, context.userId);

    if (sub.final_score == null || !sub.final_feedback) {
      throw new Error("A correção deve ser salva antes de exportar o PDF.");
    }

    const ident = await loadIdentificationContext(sub, data.kind);
    const { buildMaterialDocumentPDF } = await import("./ai-export.functions");

    // Reconstruct interactive answers if applicable
    let submissionContent = "";
    const rawSub = sub as unknown as { file_url: string; attachments?: { answers?: Record<string, string>; questions?: string[] } };
    if (rawSub.file_url === "inline_submission" && rawSub.attachments?.answers) {
      const answers = rawSub.attachments.answers;
      const questions = rawSub.attachments.questions || [];
      submissionContent = Object.entries(answers)
        .map(([idx, text]) => `**Questão:** ${questions[parseInt(idx)] || `Questão ${parseInt(idx) + 1}`}\n**Resposta:** ${text}\n`)
        .join("\n---\n");
    }

    const md = [
      `**Instituição:** ${ident.institutionName || "(não informada)"}`,
      `**Disciplina:** ${ident.disciplineName}`,
      `**Professor(a):** ${ident.teacherName}`,
      `**Aluno:** ${ident.submitterName} (${ident.submitterEnrollment || "sem matrícula"})`,
      `**Atividade:** ${sub.parent.title}`,
      `**Data da Correção:** ${sub.released_at ? new Date(sub.released_at).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR")}`,
      `---`,
      `## 1. Respostas do Aluno`,
      submissionContent || "_Conteúdo em anexo no arquivo original._",
      `---`,
      `## 2. Análise da IA e Rubrica`,
      (sub.rubric_snapshot as any[] || []).map(c => {
        const sc = (sub.rubric_scores as any[] || []).find(s => s.id === c.id);
        return `- **${c.name}:** ${sc?.score ?? 0} / ${c.max_score} (${c.weight}%)  \n  _${sc?.comment || "Sem comentário."}_`;
      }).join("\n\n"),
      `---`,
      `## 3. Feedback do Professor`,
      sub.final_feedback,
      `---`,
      `## 4. Pontuação Transparente`,
      `- **Nota Teórica (Rubrica):** ${sub.final_score.toFixed(2)}`,
      `- **Nota Final:** ${sub.final_score.toFixed(2)}`,
      `---`,
      `\n\n\n\n\n__________________________________\n**Assinatura do Professor(a):** ${ident.teacherName}`,
    ].join("\n\n");

    const bytes = await buildMaterialDocumentPDF(
      "Relatório de Feedback da Avaliação",
      null,
      md,
      null
    );

    return {
      base64: bufferToBase64(bytes),
      filename: `Feedback_${ident.submitterName.replace(/\s+/g, "_")}_${new Date().getTime()}.pdf`,
      mime: "application/pdf"
    };
  });
