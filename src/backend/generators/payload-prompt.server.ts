import {
  loadDisciplineContext,
  loadGenerationMarkdown,
  sliceMarkdownByLabel,
  saveGeneration,
} from "./generation-context.server";
import { generateSlidesLogic } from "./slides.server";
import { generateAssessmentLogic } from "./assessments.server";
import { sanitizeConceptTopic } from "@/lib/text-sanitize";


type AnyRecord = Record<string, any>;

function sanitizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(String).map(sanitizeConceptTopic).filter(Boolean);
}

export function pickDisciplineId(data: AnyRecord): string {

  const id = data.discipline_id ?? data.disciplineId;
  if (typeof id !== "string" || !id) throw new Error("Disciplina não informada.");
  return id;
}

function describeParams(data: AnyRecord, skip: string[]): string {
  return Object.entries(data)
    .filter(([k, v]) => !skip.includes(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

const TEXT_DENSITY_RULES: Record<string, string> = {
  minimo: "Cartões enxutos: no máximo 3 bullets de até 8 palavras por slide.",
  conciso: "Cartões concisos: 3 a 4 bullets de até 12 palavras por slide.",
  detalhado:
    "Cartões detalhados: 4 a 5 bullets de até 18 palavras, com termos técnicos completos e um dado/parâmetro concreto por slide.",
  extenso:
    "Cartões explicativos: 5 a 6 bullets de até 24 palavras, incluindo definição, mecanismo e valor de referência/parâmetro quando aplicável.",
};

/** Builds the slides prompt from the dialog payload (fixes prompt: undefined). */
export async function runSlidesFromPayload(data: AnyRecord, userId: string) {
  const disciplineId = pickDisciplineId(data);
  const ctx = await loadDisciplineContext(disciplineId);
  const apostilaId = data.apostila_id ?? data.apostilaId;
  const apostila = apostilaId ? await loadGenerationMarkdown(String(apostilaId)) : { title: "", markdown: "" };

  // Normalized parametrization coming from the modal (accepts both cases).
  const maxSlides = Math.max(3, Math.min(60, Number(data.max_slides ?? data.maxSlides ?? 20) || 20));
  const durationMinutes = Math.max(
    15,
    Math.min(360, Number(data.duration_minutes ?? data.durationMinutes ?? 50) || 50),
  );
  const textDensityRaw = String(data.text_amount ?? data.textDensity ?? data.text_density ?? "detalhado");
  const textDensity = textDensityRaw in TEXT_DENSITY_RULES ? textDensityRaw : "detalhado";
  const template = String(data.template ?? "moderno");
  const colorTheme = String(data.color_theme ?? data.colorTheme ?? "variado");

  const scopeLabelRaw =
    (typeof data.scope_value === "string" && data.scope_value) ||
    (typeof data.lessonId === "string" && data.lessonId) ||
    (typeof data.lesson_title === "string" && data.lesson_title) ||
    "";
  const scopeLabel = scopeLabelRaw ? sanitizeConceptTopic(scopeLabelRaw) : undefined;
  let content = sliceMarkdownByLabel(apostila.markdown, scopeLabel);

  // Fallback: sem apostila selecionada, os slides usam os conteúdos e
  // objetivos do Plano de Aula ativo da disciplina.
  if (!content.trim()) {
    const { loadPlanContext, normalizePlanId } = await import("./plan-payload.server");
    const plan = await loadPlanContext(disciplineId, normalizePlanId(data));
    content = sliceMarkdownByLabel(plan.markdown, scopeLabel) || plan.markdown;
  }

  data.topics = sanitizeStringArray(data.topics);
  data.themes = sanitizeStringArray(data.themes);

  const moduleLabel =
    (typeof data.module_title === "string" && data.module_title) ||
    (typeof data.moduleTitle === "string" && data.moduleTitle) ||
    (typeof data.module === "string" && data.module) ||
    "";
  const structureRules = [
    "ESTRUTURA OBRIGATÓRIA:",
    `- Gere exatamente ${maxSlides} slides, numerados de SLIDE 1 a SLIDE ${maxSlides}.`,
    "- SLIDE 1: Capa (Título da Apresentação + Disciplina, Professor(a), Módulo e Aula com seus temas). NÃO crie slides separados para Módulo ou Aula - essas informações já estão na Capa.",
    "- SLIDE 2 em diante: Contextualização → Fundamentação Teórica → Exemplos Práticos/Casos de Rotina → Síntese, Conexões Multidisciplinares e Desafios Atuais.",
    "- TODO slide de conteúdo (exceto Capa e Encerramento) deve ter OBRIGATORIAMENTE uma seção \"Exemplo Prático:\" com 2 a 4 bullets.",
    "- TODO slide de conteúdo deve ter OBRIGATORIAMENTE uma linha \"Imagem: https://image.pollinations.ai/prompt/[keywords]?width=800&height=450&nologo=true\".",
    "- ÚLTIMO SLIDE: Tipo de Slide: Encerramento, título \"MENSAGEM DO PROFESSOR\", parágrafo reflexivo e assinatura em maiúsculas iniciada por \"—\". NÃO inclua referências bibliográficas.",
    "- Todos os slides devem ter \"Notas do Professor:\".",
    moduleLabel ? `- Módulo: ${moduleLabel}` : null,
    ctx.teacherName ? `- Assinatura do último slide: — PROF. ${ctx.teacherName.toUpperCase()}` : null,
  ].filter(Boolean);

  const prompt =
    typeof data.prompt === "string" && data.prompt.trim()
      ? [
          data.prompt.trim(),
          "",
          "PARÂMETROS OBRIGATÓRIOS:",
          `- Número de slides: ${maxSlides}`,
          `- Duração estimada da aula: ${durationMinutes} minutos`,
          `- Densidade de texto: ${TEXT_DENSITY_RULES[textDensity]}`,
          ctx.disciplineName ? `- Disciplina: ${ctx.disciplineName}` : null,
          ctx.teacherName ? `- Professor(a): ${ctx.teacherName}` : null,
          scopeLabel ? `- Tema da aula (use como título do slide de capa): ${scopeLabel}` : null,
          "",
          ...structureRules,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Disciplina: ${ctx.disciplineName || "Não informada"}`,
          ctx.teacherName ? `Professor(a): ${ctx.teacherName}` : null,
          ctx.institutionName ? `Instituição: ${ctx.institutionName}` : null,
          apostila.title ? `Apostila base: ${apostila.title}` : null,
          scopeLabel ? `Tema da aula (título obrigatório da capa): ${scopeLabel}` : "Recorte: apostila completa",
          `Número de slides: ${maxSlides}`,
          `Duração estimada: ${durationMinutes} minutos`,
          `Densidade de texto: ${TEXT_DENSITY_RULES[textDensity]}`,
          describeParams(data, [
            "prompt",
            "discipline_id",
            "disciplineId",
            "apostila_id",
            "apostilaId",
            "scope_value",
          ]),
          "",
          ...structureRules,
          "",
          "CONTEÚDO BASE (apostila):",
          content || "(conteúdo não disponível)",
        ]
          .filter(Boolean)
          .join("\n");



  const result = await generateSlidesLogic({ prompt });
  const title = `Slides — ${scopeLabel || apostila.title || ctx.disciplineName || "Aula"}`;
  return saveGeneration({
    userId,
    disciplineId,
    tool: "slides",
    title,
    // Top-level design keys are read back by the PPTX/PDF exporters.
    prompt: {
      payload: data,
      color_theme: colorTheme,
      template,
      max_slides: maxSlides,
      text_density: textDensity,
    },
    result,
  });
}


/** Builds the assessment/exercise prompt with the real discipline name injected. */
export async function runAssessmentFromPayload(
  data: AnyRecord,
  userId: string,
  tool: "quiz" | "exercise_list",
) {
  const disciplineId = pickDisciplineId(data);
  const ctx = await loadDisciplineContext(disciplineId);
  const apostila = data.apostila_id ? await loadGenerationMarkdown(String(data.apostila_id)) : { title: "", markdown: "" };
  const label =
    sanitizeConceptTopic(
      (typeof data.lesson_title === "string" && data.lesson_title) ||
      (typeof data.module_label === "string" && data.module_label) ||
      "",
    ) || undefined;
  const content = sliceMarkdownByLabel(apostila.markdown, label);

  const headerDiscipline =
    (typeof data.header?.discipline === "string" && data.header.discipline.trim()) || "";
  const disciplineName =
    ctx.disciplineName ||
    (headerDiscipline && !/^disciplina$/i.test(headerDiscipline) ? headerDiscipline : "") ||
    "Não informada";

  data.topics = sanitizeStringArray(data.topics);
  data.themes = sanitizeStringArray(data.themes);
  data.modules = sanitizeStringArray(data.modules);

  const exerciseRules = tool === "exercise_list"
    ? [
        "REGRAS EXCLUSIVAS PARA EXERCÍCIOS:",
        "Use os conceitos técnicos completos extraídos da apostila, preservando sua nomenclatura integral, siglas, hifens, parênteses e qualificadores.",
        "Para níveis básico e intermediário, formule perguntas diretas, conceituais e factuais sobre esses conceitos; aumente apenas o raciocínio exigido, nunca substitua o conceito por rótulos genéricos.",
        "É proibida qualquer metalinguagem ou referência à apostila, aula, módulo, material ou texto no enunciado, nas alternativas e na explicação.",
      ].join("\n")
    : null;

  const prompt =
    typeof data.prompt === "string" && data.prompt.trim()
      ? data.prompt.trim() + "\n\nIMPORTANTE: Os textos gerados para o título e para cada tópico devem ser extremamente concisos. Cada tópico deve ter no máximo 150 caracteres."
      : [
          `Disciplina: ${disciplineName}`,
          ctx.teacherName ? `Professor(a): ${ctx.teacherName}` : null,
          ctx.institutionName ? `Instituição: ${ctx.institutionName}` : null,
          apostila.title ? `Apostila base: ${apostila.title}` : null,
          label ? `Aula/Módulo: ${label}` : null,
          exerciseRules,
          describeParams(data, ["prompt", "discipline_id", "disciplineId", "apostila_id", "header"]),
          "",
          "IMPORTANTE: Os textos gerados para o título e para cada tópico devem ser extremamente concisos. Cada tópico deve ter no máximo 150 caracteres.",
          "CONTEÚDO BASE (apostila):",
          content || "(conteúdo não disponível)",
        ]
          .filter(Boolean)
          .join("\n");

  // Quantidade pedida pelo professor. A IA frequentemente entrega menos
  // questões do que o solicitado, então reforçamos no prompt e completamos
  // o que faltar com chamadas adicionais.
  const requested = resolveRequestedQuestionCount(data);
  const countRule = requested
    ? [
        "",
        "QUANTIDADE OBRIGATÓRIA:",
        `- Gere EXATAMENTE ${requested} questões completas, numeradas de "Questão 1" até "Questão ${requested}".`,
        "- Cada questão precisa ter enunciado, todas as alternativas, a linha \"Gabarito: X\" e a justificativa.",
        `- É PROIBIDO entregar menos de ${requested} questões, encerrar com \"...\" ou sugerir que o restante seja criado depois.`,
      ].join("\n")
    : "";

  const basePrompt = `${prompt}${countRule}`;

  const run = (p: string) =>
    generateAssessmentLogic({
      tool,
      prompt: p,
      disciplineId,
      materialTitle: tool === "quiz" ? "Avaliação" : "Lista de Exercícios",
      modules: data.modules.length ? data.modules : label ? [label] : [],
      themes: data.themes.length ? data.themes : data.topics,
      teacherOverride: ctx.teacherName || undefined,
    });

  let result = await run(basePrompt);

  if (requested) {
    const { parseQuestionsFromText } = await import("@/lib/question-parser");
    const countUsable = (text: unknown) =>
      parseQuestionsFromText(text).filter((q) => (q.options?.length ?? 0) >= 2).length;

    let have = countUsable(result);
    for (let attempt = 0; attempt < 3 && have < requested; attempt++) {
      const missing = requested - have;
      const continuation = await run(
        [
          basePrompt,
          "",
          "CONTINUAÇÃO DA MESMA LISTA:",
          `- Já existem ${have} questões geradas. Gere APENAS as ${missing} questões restantes, inéditas e sem repetir temas já usados.`,
          `- Numere-as de "Questão ${have + 1}" até "Questão ${requested}".`,
          "- Não repita cabeçalhos, títulos, instruções ou questões anteriores: retorne somente as novas questões.",
        ].join("\n"),
      );
      const extra = typeof continuation === "string" ? continuation.trim() : "";
      if (!extra || countUsable(extra) === 0) break;
      result = `${typeof result === "string" ? result : String(result ?? "")}\n\n${extra}`;
      const next = countUsable(result);
      if (next <= have) break;
      have = next;
    }
  }

  const kindLabel = tool === "quiz" ? "Avaliação" : "Lista de Exercícios";
  const title = `${kindLabel} — ${label || apostila.title || disciplineName}`;
  return saveGeneration({
    userId,
    disciplineId,
    tool,
    title,
    prompt: {
      payload: data,
      requested_questions: requested ?? null,
      // Dica textual lida pelo preview para avisar o professor quando a
      // extração ficar abaixo do pedido.
      hint: requested ? `${requested} questões solicitadas` : undefined,
    },
    result,
  });
}

/** Lê o total de questões pedido no payload (total direto ou soma da distribuição). */
function resolveRequestedQuestionCount(data: AnyRecord): number | null {
  const direct = Number(
    data.total_questions ?? data.totalQuestions ?? data.num_questions ?? data.question_count ?? 0,
  );
  if (Number.isFinite(direct) && direct > 0) return Math.min(100, Math.round(direct));
  const dist = data.distribution ?? data.distribuicao;
  if (dist && typeof dist === "object") {
    const sum = Object.values(dist as Record<string, unknown>).reduce<number>(
      (acc, v) => acc + (Number(v) || 0),
      0,
    );
    if (sum > 0) return Math.min(100, Math.round(sum));
  }
  return null;
}
