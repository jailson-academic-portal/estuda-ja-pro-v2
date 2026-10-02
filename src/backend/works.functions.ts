import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents, notifyUsers } from "./notifications.server";
import { callAIJson, callAIText } from "./ai.server";
import { assertTeacherOrAdmin, userIsAdmin } from "./discipline-access.server";
import {
  parseDocumentHeader,
  stripLeadingStandardHeader,
  extractStandardHeaderDocLine,
} from "@/lib/document-header";
import { WORK_SUBTYPE_LABELS } from "@/lib/rubric-library";
import { notifyTeacherOfSubmission } from "./submissions-notify.server";
import { isLaunchableDiaryAssessmentId, type DiaryAssessmentSource } from "@/lib/diary-assessments";
import { getAIGeneration } from "./ai-assistant.functions";

const RubricCriterion = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(30000).optional(),
  weight: z.number().min(0).max(100),
  max_score: z.number().min(0.1).max(100).default(10),
});

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

async function assertValidDiaryAssessmentId(disciplineId: string, diaryAssessmentId?: string | null) {
  if (!diaryAssessmentId) return;
  const { data, error } = await supabaseAdmin
    .from("grade_structures")
    .select("assessments")
    .eq("discipline_id", disciplineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assessments = (data?.assessments as unknown as DiaryAssessmentSource[]) ?? [];
  if (!isLaunchableDiaryAssessmentId(assessments, diaryAssessmentId)) {
    throw new Error("Campo do diário inválido. Se a coluna tiver sub-itens, selecione um subcampo específico.");
  }
}

function cleanWorkInstructions(markdown?: string | null) {
  const withoutDueSection = (markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/(^|\n)#{1,6}\s*Prazo\s+de\s+Entrega[\s\S]*?(?=\n#{1,6}\s|$)/gi, "\n")
    .replace(
      /(^|\n)\s*(?:Prazo\s+de\s+Entrega|Data\s+de\s+Entrega|A\s+definir\s+(?:a\s+)?data\s+de\s+entrega|Data\s+de\s+entrega\s+a\s+definir).*?(?=\n|$)/gi,
      "\n",
    );

  const body = withoutDueSection
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (
        /^#{1,6}\s*(?:EMENTA|ASSUNTO)(?:\s+[—-])?\s*(?:TRABALHO\s+ACAD[EÊ]MICO)?\s*$/i.test(trimmed)
      )
        return false;
      if (/^(?:EMENTA|ASSUNTO)(?:\s+[—-])?\s*(TRABALHO\s+ACAD[EÊ]MICO)?\s*$/i.test(trimmed))
        return false;
      if (/^#{1,6}\s*(Cabe[cç]alho|Dados\b)/i.test(trimmed)) return false;
      if (
        /^(?:[-*•]\s*)?\*\*(Data\s+de\s+Envio|Curso|Disciplina|Professor(?:\(a\))?|Tema\s+do\s+Trabalho):\*\*/i.test(
          trimmed,
        )
      )
        return false;
      if (
        /^(?:[-*•]\s*)?(Data\s+de\s+Envio|Curso|Disciplina|Professor(?:\(a\))?|Tema\s+do\s+Trabalho):/i.test(
          trimmed,
        )
      )
        return false;
      return true;
    })
    .join("\n");
  const objectiveMatch = body.match(/(^|\n)#{1,6}\s*Objetivos\s+de\s+Aprendizagem\b/i);
  return (objectiveMatch?.index ? body.slice(objectiveMatch.index) : body).trim();
}

function ensureLearningObjectivesFirst(markdown: string) {
  const body = markdown.trim();
  if (!body) return "## Objetivos de Aprendizagem\n\nNão informados.";
  return /^#{1,6}\s*Objetivos\s+de\s+Aprendizagem\b/i.test(body)
    ? body
    : `## Objetivos de Aprendizagem\n\n${body}`;
}

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const saveAcademicWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        discipline_id: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        instructions: z.string().trim().max(30000).optional(),
        subtype: z
          .enum([
            "tcc",
            "artigo_cientifico",
            "revisao_literatura",
            "estudo_caso_academico",
            "projeto_intervencao",
            "relatorio_pesquisa",
            "resumo_expandido",
            "poster_cientifico",
            "tema_predefinido",
          ])
          .default("tema_predefinido"),
        due_at: z.string().optional().nullable(),
        due_time: z.string().optional().nullable(),
        late_tolerance_date: z.string().optional().nullable(),
        late_tolerance_time: z.string().optional().nullable(),
        late_penalty_type: z.enum(["percentage", "fixed"]).optional().nullable(),
        rubric: z.array(RubricCriterion).max(20).default([]),
        grading_formula: z.enum(["weighted_average", "simple_average"]).default("weighted_average"),
        structure_config: z.any().optional(),
        format_config: z.any().optional(),
        cover_config: z.any().optional(),
        delivery_type: z.enum(["individual", "group"]).default("individual"),
        max_group_size: z.number().int().min(2).max(50).nullable().optional(),
        allow_late: z.boolean().default(false),
        late_penalty_per_day: z.number().min(0).max(100).nullable().optional(),
        diary_assessment_id: z.string().max(80).nullable().optional(),
        publish: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    await assertValidDiaryAssessmentId(data.discipline_id, data.diary_assessment_id);
    const status = data.publish ? "published" : "draft";
    const payload = {
      discipline_id: data.discipline_id,
      title: data.title,
      instructions: data.instructions ?? null,
      subtype: data.subtype as never,
      grading_formula: data.grading_formula,
      due_at: data.due_at ?? null,
      due_time: data.due_time ?? "23:59:59",
      late_tolerance_date: data.late_tolerance_date ?? null,
      late_tolerance_time: data.late_tolerance_time ?? "23:59:59",
      late_penalty_type: data.late_penalty_type ?? "percentage",
      rubric: data.rubric,
      structure_config: data.structure_config ?? null,
      format_config: data.format_config ?? null,
      cover_config: data.cover_config ?? null,
      delivery_type: data.delivery_type,
      max_group_size: data.delivery_type === "group" ? (data.max_group_size ?? 2) : null,
      allow_late: data.allow_late,
      late_penalty_per_day: data.allow_late ? (data.late_penalty_per_day ?? 0) : null,
      diary_assessment_id: data.diary_assessment_id ?? null,
      status: status as "published" | "draft",
      created_by: context.userId,
    };
    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("academic_works")
        .update(payload)
        .eq("id", data.id)
        .eq("created_by", context.userId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Trabalho não encontrado ou sem permissão");
    } else {
      const { error } = await supabaseAdmin.from("academic_works").insert(payload);
      if (error) throw new Error(error.message);
    }
    if (data.publish) {
      await notifyEnrolledStudents(
        data.discipline_id,
        "new_work",
        "Novo trabalho acadêmico publicado",
        data.title,
        `/disciplines/${data.discipline_id}`,
      );
    }
    return { ok: true };
  });

export const deleteAcademicWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: w } = await supabaseAdmin
      .from("academic_works")
      .select("discipline_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!w) throw new Error("Trabalho não encontrado");
    await assertTeacher(w.discipline_id, context.userId);
    await supabaseAdmin.from("academic_works").delete().eq("id", data.id);
    return { ok: true };
  });

export const submitAcademicWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        work_id: z.string().uuid(),
        student_id: z.string().uuid().optional(),
        file_url: z.string().min(1).max(500),
        submission_text: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const studentId = data.student_id || context.userId;
    
    // Usamos upsert com student_id explícito para garantir conformidade com RLS WITH CHECK
    const { error } = await supabaseAdmin.from("academic_work_submissions").upsert(
      ({
        work_id: data.work_id,
        student_id: studentId,
        file_url: data.file_url,
        submission_text: data.submission_text ?? null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      } as any),
      { onConflict: "work_id,student_id" },
    );
    if (error) throw new Error(error.message);
    const { data: work } = await supabaseAdmin
      .from("academic_works")
      .select("discipline_id,title")
      .eq("id", data.work_id)
      .maybeSingle();
    if (work) {
      await notifyTeacherOfSubmission({
        disciplineId: work.discipline_id,
        studentId: context.userId,
        kind: "work",
        parentTitle: work.title,
      });
    }
    return { ok: true };
  });

function sanitizeFilename(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "trabalho-academico"
  );
}

/**
 * Exports an academic work statement as a branded PDF using the SAME renderer /
 * header as apostilas, materials and activities (logo + Disciplina / Curso /
 * Professor(a) + theme line). Preserves **bold** keywords and renders the
 * evaluation criteria as an individual-line list. Identical output for teacher
 * and enrolled students.
 */
export const exportAcademicWorkPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ work_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: work } = await supabaseAdmin
      .from("academic_works")
      .select("id,title,instructions,subtype,due_at,created_at,status,discipline_id")
      .eq("id", data.work_id)
      .maybeSingle();
    if (!work) throw new Error("Trabalho não encontrado");
    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("id,teacher_id")
      .eq("id", work.discipline_id)
      .maybeSingle();
    if (!disc) throw new Error("Disciplina não encontrada");
    const isTeacher = disc.teacher_id === context.userId || (await userIsAdmin(context.userId));
    if (!isTeacher) {
      if (work.status !== "published") throw new Error("Trabalho indisponível");
      const { data: enrollment } = await supabaseAdmin
        .from("discipline_students")
        .select("id")
        .eq("discipline_id", disc.id)
        .eq("student_id", context.userId)
        .maybeSingle();
      if (!enrollment) throw new Error("Sem permissão");
    }
    const custom = parseDocumentHeader(work.instructions);
    const subtypeLabel = WORK_SUBTYPE_LABELS[work.subtype as string] ?? "Trabalho Acadêmico";
    // Reproduce the exact identification line baked into the stored header
    // (e.g. "**Estudo de Caso:** Módulo 1: …"); fall back to the saved theme.
    const docLine =
      extractStandardHeaderDocLine(work.instructions) ??
      (custom?.theme ? { label: subtypeLabel, value: custom.theme } : null);
    const body = ensureLearningObjectivesFirst(
      cleanWorkInstructions(stripLeadingStandardHeader(work.instructions)),
    );
    const { buildStandardDocumentHeader } = await import("./ai-assistant.functions");
    const { buildMaterialDocumentPDF } = await import("./ai-export.functions");
    const header = await buildStandardDocumentHeader(work.discipline_id, {
      docLabel: docLine?.label ?? subtypeLabel,
      docValue: docLine?.value ?? custom?.theme ?? work.title,
      courseOverride: custom?.course_name ?? null,
      teacherOverride: custom?.teacher_name ?? null,
    });
    const markdown = header ? `${header}\n${body}` : body;
    const bytes = await buildMaterialDocumentPDF(work.title, null, markdown, null);
    return {
      filename: `${sanitizeFilename(work.title)}.pdf`,
      mime: "application/pdf",
      base64: bufferToBase64(bytes),
    };
  });

/* ---------- PDF do Trabalho ABNT (aba 7. Finalizar) ---------- */

const WorkCoverPDFSchema = z.object({
  logo_data_url: z.string().max(3_000_000).nullable().optional(),
  institution: z.string().max(200).nullable().optional(),
  author: z.string().max(400).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  city: z.string().max(200).nullable().optional(),
  year: z.string().max(20).nullable().optional(),
});

const WorkSectionPDFSchema = z.object({
  heading: z.string().max(200).nullable().optional(),
  body: z.string().max(60000).nullable().optional(),
});

/**
 * Gera o PDF do trabalho do estudante (aba 7. Finalizar do Assistente de
 * Trabalho ABNT) com a capa no padrão ABNT NBR 14724: fonte Arial/Times New
 * Roman 12, margens de 3 cm (superior/esquerda) e 2 cm (inferior/direita),
 * logo opcional no topo (máx. 120x120 px), instituição em caixa alta
 * centralizada, autor(es) em caixa alta de 3 a 5 linhas abaixo, título em
 * caixa alta e negrito no meio da página e cidade/ano no rodapé.
 */
export const exportWorkCoverPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        cover: WorkCoverPDFSchema,
        sections: z.array(WorkSectionPDFSchema).max(40).default([]),
        file_name: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { buildAcademicWorkPDF } = await import("./work-pdf.server");
    const bytes = await buildAcademicWorkPDF({
      cover: data.cover,
      sections: data.sections,
    });
    return {
      filename: `${sanitizeFilename(data.file_name || data.cover.title || "trabalho-academico")}.pdf`,
      mime: "application/pdf",
      base64: bufferToBase64(bytes),
    };
  });

/** AI-powered ABNT compliance + content evaluation. */
export const reviewWorkWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        submission_id: z.string().uuid(),
        submission_text: z.string().min(1).max(80000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("academic_work_submissions")
      .select("*, academic_works!inner(*)")
      .eq("id", data.submission_id)
      .maybeSingle();
    if (!sub) throw new Error("Submissão não encontrada");
    const work = sub.academic_works as {
      discipline_id: string;
      rubric: unknown;
      instructions: string | null;
      title: string;
      structure_config: unknown;
      format_config: unknown;
    };
    await assertTeacher(work.discipline_id, context.userId);

    const [contentReport, abntReport] = await Promise.all([
      callAIJson<{
        rubric_scores: Array<{ id: string; score: number; comment: string }>;
        total_score: number;
        summary: string;
      }>({
        system:
          "Você é um avaliador acadêmico rigoroso e focado no ISOLAMENTO DOS 5 CRITÉRIOS. Avalie a rubrica respeitando absolutamente a blindagem do conteúdo: erros de formatação, ausência de citações ou normas ABNT devem descontar pontos EXCLUSIVAMENTE no critério de estrutura/forma. É TERMINANTEMENTE PROIBIDO penalizar critérios de conteúdo como Desenvolvimento, Fundamentação, Tema ou Análise Crítica por problemas de formatação. Responda em JSON.",
        user: `Trabalho: ${work.title}\nInstruções: ${work.instructions ?? "—"}\nRubrica: ${JSON.stringify(work.rubric)}\n\nTexto do aluno:\n${data.submission_text}\n\nResponda em JSON: rubric_scores, total_score (0-10), summary.`,
      }),
      callAIJson<{
        compliance_score: number;
        issues: Array<{
          section: string;
          rule: string;
          severity: "low" | "medium" | "high";
          suggestion: string;
        }>;
        summary: string;
      }>({
        system:
          "Você é um especialista em normas ABNT. Verifique conformidade ABNT e responda em JSON.",
        user: `Estrutura exigida: ${JSON.stringify(work.structure_config ?? {})}\nFormato exigido: ${JSON.stringify(work.format_config ?? {})}\n\nTexto:\n${data.submission_text}\n\nResponda em JSON: compliance_score (0-10), issues[], summary.`,
      }),
    ]);

    await supabaseAdmin
      .from("academic_work_submissions")
      .update(({
        content_report: contentReport,
        abnt_report: abntReport,
        rubric_scores: contentReport.rubric_scores,
        total_score: contentReport.total_score,
        status: "ai_corrected",
      } as any))
      .eq("id", data.submission_id);
    return { content: contentReport, abnt: abntReport };
  });

export const releaseWorkFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        submission_id: z.string().uuid(),
        teacher_comment: z.string().trim().max(30000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("academic_work_submissions")
      .select("*, academic_works!inner(discipline_id)")
      .eq("id", data.submission_id)
      .maybeSingle();
    if (!sub) throw new Error("Submissão não encontrada");
    const work = sub.academic_works as unknown as { discipline_id: string };
    await assertTeacher(work.discipline_id, context.userId);
    await supabaseAdmin
      .from("academic_work_submissions")
      .update(({
        released_at: new Date().toISOString(),
        status: "released",
        teacher_comment: data.teacher_comment ?? null,
      } as any))
      .eq("id", data.submission_id);
    await notifyUsers(
      [sub.student_id],
      "feedback_available",
      "Feedback do trabalho disponível",
      undefined,
      `/disciplines/${work.discipline_id}`,
    );
    return { ok: true };
  });

/* ---------- Tutor IA do Assistente de Trabalho ABNT ---------- */

const WORK_TUTOR_SECTIONS = [
  "capa",
  "resumo",
  "introducao",
  "desenvolvimento",
  "metodologia",
  "consideracoes",
  "finalizar",
] as const;

type WorkTutorSection = (typeof WORK_TUTOR_SECTIONS)[number];

/**
 * PERSONA BASE FIXA do Tutor IA do Assistente de Trabalho ABNT.
 * Vale para TODAS as abas: método do sanduíche, tom encorajador e proibição
 * absoluta de entregar a resposta pronta ao estudante.
 */
const WORK_TUTOR_BASE_PERSONA = [
  "Você é o Tutor IA do módulo 'Assistente de Trabalho ABNT', um(a) orientador(a) acadêmico(a) experiente, paciente e encorajador(a).",
  "Sua função é ORIENTAR o estudante durante a escrita do trabalho acadêmico — nunca escrever por ele.",
  "PROIBIÇÕES ABSOLUTAS: nunca reescreva, corrija ou entregue o texto pronto; nunca forneça parágrafos, frases, títulos, resumos ou trechos para o estudante copiar; nunca dê a resposta direta da tarefa; nunca invente referências, autores, anos, dados, estatísticas ou citações; nunca atribua nota, desconto de pontos ou mencione o processo de correção (sua atuação é pedagógica e formativa).",
  "MÉTODO DO SANDUÍCHE (obrigatório em toda resposta, nesta ordem): (1) PONTOS FORTES — reconheça de forma sincera e específica o que o estudante já fez bem, citando um trecho real do texto dele; (2) O QUE MELHORAR — apresente de 3 a 5 fragilidades ou oportunidades, sempre explicando o porquê e COMO corrigir, por meio de perguntas e critérios, sem escrever o texto no lugar dele; (3) PRÓXIMOS PASSOS — encerre com uma mensagem encorajadora que reconheça o esforço e proponha uma ação concreta e realizável.",
  "FORMATO DA RESPOSTA: português do Brasil, Markdown curto, exatamente com os blocos 'PONTOS FORTES', 'O QUE MELHORAR' (lista numerada) e 'PRÓXIMOS PASSOS'. Tom respeitoso, sem julgamentos, sem ironia e sem termos que constranjam o estudante.",
  "Se o texto estiver vazio, muito curto, ilegível ou fora do tema, diga isso com gentileza na abertura, explique o que falta e indique por onde começar.",
  "Nunca mencione as outras abas nem o resultado da correção final: oriente apenas a etapa atual.",
].join(" ");

/** Instruções específicas somadas à persona base, conforme a ABA ativa. */
const WORK_TUTOR_SECTION_INSTRUCTIONS: Record<WorkTutorSection, string> = {
  capa: [
    "ABA ATIVA: 1. Capa e identificação (ABNT NBR 14724).",
    "Verifique se a capa contém todos os elementos exigidos: nome da instituição, curso, nome completo do(s) autor(es), título/tema do trabalho, cidade e ano.",
    "Confira também: título claro e alinhado ao tema proposto, autor(es) sem abreviações ou apelidos, grafia correta dos nomes próprios da instituição e do curso, coerência entre cidade/ano e o período de entrega e ausência de dados genéricos ou de exemplo.",
    "Oriente sobre padronização e hierarquia visual (fonte Arial ou Times New Roman 12, textos centralizados, título em negrito, blocos institucionais em maiúsculas), explicando a finalidade de cada item em vez de reescrevê-lo.",
    "Se algum dado estiver ausente, incompleto ou claramente incorreto, pergunte ao estudante qual informação ele deve inserir.",
  ].join(" "),
  resumo: [
    "ABA ATIVA: 2. Resumo e palavras-chave.",
    "Avalie a estrutura do resumo: parágrafo único, 150 a 500 palavras, sem tópicos, sem listas, sem citações, sem tabelas e sem abreviações não explicadas.",
    "Verifique se o resumo contempla tema, objetivo, metodologia, resultados principais e conclusão — aponte exatamente qual desses elementos está faltando ou está superficial.",
    "Confira também a impessoalidade (sem primeira pessoa, sem marcas de oralidade) e a coerência entre o que o resumo promete e o que o trabalho se propõe a fazer.",
    "Nas palavras-chave, verifique quantidade (3 a 5), separação por ponto e vírgula, termos representativos do tema e ausência de repetição de palavras do título.",
    "Aponte onde estão os problemas e o critério a corrigir, sem reescrever o resumo nem sugerir frases prontas.",
  ].join(" "),
  introducao: [
    "ABA ATIVA: 3. Introdução.",
    "Verifique se a introdução apresenta o tema, contextualiza o problema, delimita a pergunta de pesquisa, define objetivo geral e objetivos específicos e justifica a relevância acadêmica e profissional do trabalho.",
    "Avalie o encadeamento lógico (do geral para o específico), a progressão das ideias e a coerência entre problema, objetivos e justificativa.",
    "Confira as citações no formato autor-data, por exemplo (SOBRENOME, ano), e se toda ideia de outro autor está creditada.",
    "Aponte trechos genéricos, de senso comum, opiniões sem respaldo, objetivos vagos ou não verificáveis e afirmações sem fonte, explicando como torná-los mensuráveis.",
    "Extensão sugerida: 2 a 3 páginas. Não escreva a introdução pelo estudante: faça perguntas que o ajudem a perceber o que falta.",
  ].join(" "),
  desenvolvimento: [
    "ABA ATIVA: 4. Desenvolvimento / Revisão de Literatura.",
    "Verifique a fundamentação teórica: presença de autores que sustentam o tema, organização em subtítulos coerentes, diálogo entre os estudos (comparar, contrastar, apontar convergências e lacunas) e análise crítica em vez de simples descrição ou resumo de autores.",
    "Avalie a ligação de cada seção com o objetivo do trabalho e se os argumentos avançam em relação à introdução.",
    "Cheque as citações no formato autor-data, o uso de aspas em citações diretas de até 3 linhas e, acima disso, o bloco recuado de 4 cm com fonte 10 e espaçamento simples.",
    "Sinalize trechos que aparentem cópia sem crédito e explique, com delicadeza, o que é plágio e como parafrasear atribuindo corretamente a fonte, sem reescrever o trecho.",
    "Aponte generalizações, falta de dados de apoio, saltos argumentativos e trechos desconectados do tema.",
  ].join(" "),
  metodologia: [
    "ABA ATIVA: 5. Metodologia.",
    "Verifique se estão descritos: tipo de pesquisa (bibliográfica, documental, de campo, estudo de caso, revisão sistemática), participantes ou amostra, instrumentos de coleta de dados, procedimentos de análise e, quando houver seres humanos envolvidos, os cuidados éticos (CEP/CONEP, TCLE, anonimato dos participantes e guarda dos dados).",
    "Avalie se o texto é detalhado o suficiente para que outro pesquisador consiga reproduzir o percurso metodológico.",
    "Confira a coerência entre o método descrito, a pergunta de pesquisa e os objetivos declarados na introdução.",
    "Aponte termos vagos ('alguns autores', 'foi pesquisado', 'foram analisados dados'), ausência de critérios de inclusão/exclusão, falta de justificativa para a escolha do método e descolamento entre método e problema.",
    "Não reescreva os procedimentos: indique o que precisa ser explicitado e por quê.",
  ].join(" "),
  consideracoes: [
    "ABA ATIVA: 6. Considerações finais e referências.",
    "Nas considerações finais, verifique se o estudante retoma os objetivos, sintetiza os principais achados, aponta as limitações do estudo e sugere trabalhos futuros, sem introduzir dados novos e sem repetir literalmente trechos já escritos.",
    "Cheque se as conclusões são sustentadas pelas evidências apresentadas no desenvolvimento, sem exageros ou generalizações indevidas.",
    "Nas referências, verifique se aparecem apenas as obras efetivamente citadas, em ordem alfabética, no padrão ABNT NBR 6023 (SOBRENOME, Nome. Título. Cidade: Editora, ano.) e se cada citação do corpo do trabalho tem referência correspondente — e vice-versa.",
    "Aponte inconsistências de autoria, ano, título, editora e formatação, explicando o critério a corrigir sem reescrever as referências.",
    "Além disso, oriente sobre o uso ético e responsável da IA como ferramenta de apoio, de forma educativa e não punitiva.",
  ].join(" "),
  finalizar: [
    "ABA ATIVA: 7. Revisão final e envio.",
    "Faça uma leitura global do trabalho (capa, resumo e palavras-chave, introdução, desenvolvimento, metodologia, considerações finais e referências) e verifique: coerência e encadeamento entre as seções, aderência ao tema e ao enunciado do professor, padronização dos títulos e da numeração progressiva das seções, ortografia, pontuação, concordância e clareza.",
    "Confira o alinhamento entre as citações do corpo do trabalho e a lista de referências, além dos elementos gerais de formatação ABNT (margens, espaçamento, paginação, alinhamento e uso de recursos visuais).",
    "Monte uma lista de verificação final priorizada, separando o que é imprescindível corrigir antes de enviar e o que é recomendável.",
    "Não reescreva nenhum trecho do trabalho: apenas indique o que revisar e por quê.",
    "Termine com uma mensagem encorajadora, reconhecendo o percurso do estudante até aqui.",
  ].join(" "),
};

/** Monta o System Prompt dinâmico: persona base fixa + instruções da aba ativa. */
function buildWorkTutorSystemPrompt(section: WorkTutorSection): string {
  const sectionRules = WORK_TUTOR_SECTION_INSTRUCTIONS[section] ?? WORK_TUTOR_SECTION_INSTRUCTIONS.introducao;
  return [WORK_TUTOR_BASE_PERSONA, sectionRules].join("\n\n");
}

/**
 * Tutor IA do Assistente de Trabalho ABNT: orienta o estudante na aba ativa
 * (capa, resumo, introdução, desenvolvimento, metodologia, considerações finais
 * ou revisão final) com a persona base + regras específicas da etapa.
 */
export const getWorkTutorGuidance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        section: z.enum(WORK_TUTOR_SECTIONS).default("introducao"),
        text: z.string().min(1).max(50000),
        title: z.string().max(300).optional(),
        instructions: z.string().max(30000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = [
      data.title?.trim() ? `[TRABALHO] ${data.title.trim()}` : "",
      data.instructions?.trim()
        ? `[ENUNCIADO/ORIENTAÇÕES DO PROFESSOR — use como referência de tema e formato]\n${data.instructions.trim()}`
        : "",
      `[ABA ATIVA] ${data.section}`,
      `[TEXTO DO ESTUDANTE NESTA ETAPA]\n${data.text}`,
      "Devolva a orientação no formato combinado (PONTOS FORTES, O QUE MELHORAR, PRÓXIMOS PASSOS), falando apenas desta etapa e sem escrever o texto pelo estudante.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return callAIText({
      system: buildWorkTutorSystemPrompt(data.section),
      user,
    });
  });

/**
 * "Elaborar Diretrizes / Ementa com IA": gera a estrutura acadêmica completa do
 * trabalho (contextualização, problema de pesquisa, estrutura do documento,
 * rubrica/critérios e fontes normativas) a partir do tema e objetivos atuais.
 * Retorna Markdown pronto para ser salvo no enunciado do trabalho.
 */
export const generateWorkGuidelines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        work_id: z.string().uuid(),
        extra_context: z.string().trim().max(30000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: work, error } = await supabaseAdmin
      .from("academic_works")
      .select("id, discipline_id, title, subtype, instructions")
      .eq("id", data.work_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!work) throw new Error("Trabalho não encontrado.");
    await assertTeacher(work.discipline_id, context.userId);

    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("name, group_name")
      .eq("id", work.discipline_id)
      .maybeSingle();

    const typeLabel =
      (work.subtype && WORK_SUBTYPE_LABELS[work.subtype as keyof typeof WORK_SUBTYPE_LABELS]) ||
      "Trabalho Acadêmico";

    const system = `Você é um professor(a) universitário(a) especialista em metodologia científica.
Elabore as DIRETRIZES/EMENTA completas de um trabalho acadêmico para os alunos, em português do Brasil.

Responda EXCLUSIVAMENTE em Markdown, sem preâmbulos conversacionais ("Aqui estão...", "Claro!"),
sem blocos de código e sem comentários HTML. Use EXATAMENTE estas seções, nesta ordem:

## Contextualização e Justificativa Acadêmica
(2 a 3 parágrafos ligando o tema à prática profissional e à disciplina.)

## Problema de Pesquisa / Pergunta Norteadora
(1 pergunta norteadora principal em destaque e 2 a 3 questões secundárias em lista.)

## Estrutura Esperada do Documento
(Lista com Introdução, Metodologia, Desenvolvimento/Discussão, Conclusão e Referências,
descrevendo o que se espera em cada parte e a extensão aproximada em páginas.)

## Critérios de Avaliação e Rubrica
(Tabela Markdown com as colunas: Critério | Descrição do desempenho esperado | Peso (%).
A soma dos pesos deve ser exatamente 100%.)

## Fontes Sugeridas e Diretrizes Normativas
(Orientações de normalização — ABNT NBR 14724/10520/6023 ou Vancouver quando for área da saúde —
e sugestões de tipos de fontes confiáveis: livros-texto, artigos indexados, diretrizes oficiais.)

Seja técnico, específico do tema e nunca use texto genérico de exemplo.`;

    const guidelines = await callAIText({
      system,
      user: [
        `Disciplina: ${disc?.name ?? ""} (curso: ${disc?.group_name ?? ""}).`,
        `Tipo/Formato do trabalho: ${typeLabel}.`,
        `Tema central: ${work.title}.`,
        work.instructions?.trim()
          ? `Objetivos/instruções já definidos pelo(a) professor(a) (respeite e aprofunde):\n${work.instructions.trim().slice(0, 6000)}`
          : "",
        data.extra_context?.trim() ? `Contexto adicional: ${data.extra_context.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const clean = String(guidelines ?? "")
      .replace(/```(?:markdown)?/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^(?:claro|certo|com certeza|perfeito|aqui\s+est[áã]o?|segue[m]?)[^\n]*\n+/i, "")
      .trim();
    if (!clean) throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
    return { guidelines: clean };
  });

/**
 * Salva apenas o enunciado (diretrizes) do trabalho, preservando prazo, tolerância,
 * configurações de formato/estrutura/capa e o cabeçalho padronizado já gravado.
 */
export const saveWorkGuidelines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        work_id: z.string().uuid(),
        instructions: z.string().trim().min(1).max(30000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: work, error } = await supabaseAdmin
      .from("academic_works")
      .select("id, discipline_id, title, instructions, status")
      .eq("id", data.work_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!work) throw new Error("Trabalho não encontrado.");
    await assertTeacher(work.discipline_id, context.userId);
    if (work.status === "published") throw new Error("Trabalho já publicado; edite pelo botão Editar.");

    const { parseDocumentHeader, withDocumentHeaderMetadata } = await import("@/lib/document-header");
    const header = parseDocumentHeader(work.instructions);
    const instructions = header
      ? withDocumentHeaderMetadata(data.instructions, { ...header, theme: header.theme || work.title })
      : data.instructions;

    const { error: upErr } = await supabaseAdmin
      .from("academic_works")
      .update({ instructions })
      .eq("id", work.id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/**
 * Publica um trabalho sem reescrever os demais campos (prazo, tolerância,
 * configurações) — ao contrário de saveAcademicWork, que faz UPDATE completo.
 */
export const publishAcademicWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ work_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: work, error } = await supabaseAdmin
      .from("academic_works")
      .select("id, discipline_id, title, diary_assessment_id, status")
      .eq("id", data.work_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!work) throw new Error("Trabalho não encontrado.");
    await assertTeacher(work.discipline_id, context.userId);
    if (!work.diary_assessment_id) throw new Error("Defina o campo do diário (Editar) antes de liberar.");
    if (work.status === "published") return { ok: true };

    const { error: upErr } = await supabaseAdmin
      .from("academic_works")
      .update({ status: "published" })
      .eq("id", work.id);
    if (upErr) throw new Error(upErr.message);

    await notifyEnrolledStudents(
      work.discipline_id,
      "new_work",
      "Novo trabalho acadêmico publicado",
      work.title,
      `/disciplines/${work.discipline_id}`,
    );
    return { ok: true };
  });
