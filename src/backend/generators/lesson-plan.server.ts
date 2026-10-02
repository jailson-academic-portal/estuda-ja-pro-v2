import { callAIText } from "../ai.server";
import { sanitizeLessonPlanMarkdown } from "../ai-assistant-core.server";
import { z } from "zod";

const LessonPlanInputSchema = z.object({
  prompt: z.string().min(1).max(24000),
  extraContext: z.string().max(10000).optional(),
});

/* ============================================================================
 * Schema JSON padronizado (base: Bioquímica Clínica)
 * ========================================================================== */

const LessonSchema = z.object({
  numero: z.coerce.number().int().min(0),
  temas: z.string().default(""),
  objetivos: z.string().default(""),
  conteudo: z.string().default(""),
  atividades: z.string().default(""),
});

const PracticalStepSchema = z.object({
  etapa: z.string().default("Etapa"),
  temas: z.string().default(""),
  objetivos: z.string().default(""),
  conteudo: z.string().default(""),
  atividades: z.string().default(""),
});

/**
 * Atividade de um módulo PRÁTICO (sem aulas teóricas): estudo de caso,
 * trabalho acadêmico ou caso clínico SimulSaúde, com a dinâmica detalhada.
 */
const PracticalActivitySchema = z.object({
  tipo: z.string().default("Atividade prática"),
  titulo: z.string().default(""),
  objetivos: z.string().default(""),
  dinamica: z.string().default(""),
  carga_horaria: z.string().default(""),
  avaliacao: z.string().default(""),
});
export type PracticalActivity = z.infer<typeof PracticalActivitySchema>;

// Itens do banco de temas: aceitamos string simples OU objeto estruturado.
const CaseStudyItemSchema = z.union([z.string(), z.object({}).passthrough()]);
const ClinicalCaseItemSchema = z.union([z.string(), z.object({}).passthrough()]);
const AcademicWorkItemSchema = z.union([z.string(), z.object({}).passthrough()]);
const ExtraActivityItemSchema = z.union([z.string(), z.object({}).passthrough()]);

const LessonPlanJsonSchema = z.object({
  cabecalho: z.object({
    disciplina: z.string().default(""),
    professor: z.string().default(""),
    periodo: z.string().default(""),
  }),
  informacoes_gerais: z.object({
    carga_horaria: z.string().default(""),
    nivel: z.string().default("Ensino Superior (Graduação)"),
    curso: z.string().default(""),
    semestre: z.string().default(""),
    ementa: z.string().default(""),
  }),
  estrutura_curso: z.object({
    numero_modulos: z.coerce.number().int().positive(),
    aulas_por_modulo: z.coerce.number().int().min(0).default(0),
    total_aulas_efetivas: z.coerce.number().int().min(0),
  }),
  modulos: z
    .array(
      z.object({
        titulo: z.string(),
        pratico: z.coerce.boolean().optional(),
        aulas: z.array(LessonSchema).default([]),
        etapas: z.array(PracticalStepSchema).default([]),
        atividades_praticas: z.array(PracticalActivitySchema).default([]),
      }),
    )
    .min(1),
  avaliacoes_trabalhos: z
    .object({
      trabalho_academico: z
        .object({
          tipo: z.string().default(""),
          lancamento: z.string().default("A definir"),
          entrega: z.string().default("A definir"),
          criterios: z.string().default(""),
        })
        .optional(),
      avaliacoes: z
        .array(
          z.object({
            titulo: z.string().default(""),
            tipo: z.string().default("Avaliação Escrita"),
            tipos_questoes: z.string().default(""),
            data_sugerida: z.string().default("A definir"),
            conteudo: z.string().default(""),
          }),
        )
        .default([]),
    })
    .optional(),
  banco_temas_sugeridos: z
    .object({
      estudos_de_caso: z.array(CaseStudyItemSchema).default([]),
      casos_clinicos: z.array(ClinicalCaseItemSchema).default([]),
      trabalho_academico: AcademicWorkItemSchema.default(""),
      atividades_extras: z.array(ExtraActivityItemSchema).default([]),
    })
    .optional(),
  referencias_bibliograficas: z.array(z.string()).default([]),
});

export type LessonPlanJson = z.infer<typeof LessonPlanJsonSchema>;

/* ---------------------------------------------------------------------------
 * Normalização dos itens do Banco de Temas (aceita string OU objeto)
 * ------------------------------------------------------------------------- */

export type CaseStudyTheme = { modulo: number; tema: string };
export type ClinicalCaseTheme = { modulo: number; tema: string; objetivos: string; cenario: string };
export type AcademicWorkTheme = { tema: string; tipo: string; objetivos: string; criterios: string };
export type ExtraActivityTheme = { modulo: number; tipo: string; titulo: string; descricao: string };

function parseModuleNumber(text: unknown): number {
  const m = String(text ?? "").match(/M[óo]dulo\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function stripModulePrefix(text: string): string {
  return text.replace(/^\s*(?:Caso Cl[íi]nico\s*(?:\(SimulSa[úu]de\))?\s*[-–—:]\s*)?M[óo]dulo\s*\d+\s*[:\-–—]\s*/i, "").trim();
}

export function normalizeCaseStudy(raw: unknown): CaseStudyTheme | null {
  if (typeof raw === "string") {
    const tema = stripModulePrefix(raw);
    return tema ? { modulo: parseModuleNumber(raw), tema } : null;
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const tema = String(r.tema ?? r.titulo ?? r.title ?? "").trim();
    if (!tema) return null;
    return { modulo: Number(r.modulo ?? 0) || parseModuleNumber(tema), tema: stripModulePrefix(tema) };
  }
  return null;
}

export function normalizeClinicalCase(raw: unknown): ClinicalCaseTheme | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    const modulo = parseModuleNumber(text);
    const tema = stripModulePrefix(text.replace(/^Caso Cl[íi]nico\s*(?:\(SimulSa[úu]de\))?\s*[-–—:]?\s*/i, ""));
    return tema ? { modulo, tema, objetivos: "", cenario: "" } : null;
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const tema = String(r.tema ?? r.titulo ?? r.title ?? "").trim();
    if (!tema) return null;
    const objetivos = Array.isArray(r.objetivos) ? r.objetivos.map(String).join("; ") : String(r.objetivos ?? "").trim();
    return {
      modulo: Number(r.modulo ?? 0) || parseModuleNumber(tema),
      tema: stripModulePrefix(tema),
      objetivos,
      cenario: String(r.cenario ?? r.contexto ?? "").trim(),
    };
  }
  return null;
}

export function normalizeAcademicWork(raw: unknown, fallbackTipo = "", fallbackCriterios = ""): AcademicWorkTheme | null {
  if (typeof raw === "string") {
    const tema = raw.trim();
    return tema ? { tema, tipo: fallbackTipo, objetivos: "", criterios: fallbackCriterios } : null;
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const tema = String(r.tema ?? r.tema_central ?? r.titulo ?? "").trim();
    if (!tema) return null;
    const objetivos = Array.isArray(r.objetivos) ? r.objetivos.map(String).join("; ") : String(r.objetivos ?? r.objetivos_especificos ?? "").trim();
    return {
      tema,
      tipo: String(r.tipo ?? "").trim() || fallbackTipo,
      objetivos,
      criterios: String(r.criterios ?? "").trim() || fallbackCriterios,
    };
  }
  return null;
}

export function normalizeExtraActivity(raw: unknown): ExtraActivityTheme | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    const m = text.match(/^\s*(Semin[áa]rio|Debate|Visita\s+T[ée]cnica|Aula\s+Pr[áa]tica|Workshop|Reda[çc][ãa]o|Relat[óo]rio|Oficina|Estudo\s+Dirigido)\s*[:\-–—]\s*(.+)$/i);
    return {
      modulo: parseModuleNumber(text),
      tipo: m ? m[1].trim() : "Atividade extra",
      titulo: stripModulePrefix(m ? m[2].trim() : text),
      descricao: "",
    };
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const titulo = String(r.titulo ?? r.tema ?? r.title ?? "").trim();
    if (!titulo) return null;
    return {
      modulo: Number(r.modulo ?? 0) || parseModuleNumber(titulo),
      tipo: String(r.tipo ?? "Atividade extra").trim(),
      titulo: stripModulePrefix(titulo),
      descricao: String(r.descricao ?? r.objetivo ?? "").trim(),
    };
  }
  return null;
}

export const LESSON_PLAN_JSON_SYSTEM = `Você é um(a) professor(a) experiente de ensino superior. Gere o PLANEJAMENTO COMPLETO de uma disciplina em pt-BR.

FORMATO DE SAÍDA (INVIOLÁVEL):
- Responda EXCLUSIVAMENTE com um único objeto JSON válido, em UTF-8.
- NUNCA use blocos de código (\`\`\`json), comentários, texto explicativo antes ou depois, nem quebras de linha literais dentro de strings.
- Todas as chaves e a estrutura devem ser exatamente as do schema abaixo.

SCHEMA OBRIGATÓRIO:
{
  "cabecalho": { "disciplina": "string", "professor": "string", "periodo": "string" },
  "informacoes_gerais": { "carga_horaria": "string", "nivel": "Ensino Superior (Graduação)", "curso": "string", "semestre": "string", "ementa": "string" },
  "estrutura_curso": { "numero_modulos": 3, "aulas_por_modulo": 3, "total_aulas_efetivas": 9 },
  "modulos": [ { "titulo": "Módulo 1: [Nome do Módulo]", "pratico": false, "aulas": [ { "numero": 1, "temas": "string", "objetivos": "string", "conteudo": "string", "atividades": "Estudo de caso: [Tema do caso 1]" } ], "etapas": [], "atividades_praticas": [ { "tipo": "Estudo de Caso | Trabalho Acadêmico | Caso Clínico (SimulSaúde)", "titulo": "string", "objetivos": "string", "dinamica": "string (descrição detalhada de como a atividade será conduzida: etapas, papéis, entregas)", "carga_horaria": "string (ex.: 4h)", "avaliacao": "string (instrumento e peso na nota do módulo)" } ] } ],
  "avaliacoes_trabalhos": { "trabalho_academico": { "tipo": "string", "lancamento": "A definir", "entrega": "A definir", "criterios": "string" }, "avaliacoes": [ { "titulo": "Avaliação 1", "tipo": "Avaliação Escrita", "tipos_questoes": "Múltipla Escolha, Verdadeiro ou Falso, Completar Lacunas", "data_sugerida": "A definir", "conteudo": "Módulo 1: [Nome do Módulo 1]" } ] },
  "banco_temas_sugeridos": {
    "estudos_de_caso": [ { "modulo": 1, "tema": "string (tema específico do estudo de caso clínico/laboratorial)" } ],
    "casos_clinicos": [ { "modulo": 1, "tema": "string", "objetivos": "string (2 a 3 objetivos de aprendizagem)", "cenario": "string (resumo do cenário clínico: paciente, queixa, contexto)" } ],
    "trabalho_academico": { "tema": "string (tema central delimitado)", "tipo": "string (copie EXATAMENTE o tipo/formato de documento informado no pedido; nunca invente outro)", "objetivos": "string (objetivos específicos)", "criterios": "string" },
    "atividades_extras": [ { "modulo": 1, "tipo": "Seminário | Debate | Visita Técnica | Aula Prática | Workshop", "titulo": "string", "descricao": "string curta" } ]
  },
  "referencias_bibliograficas": ["string em formato ABNT (3 a 5 obras)"]
}

REGRAS PEDAGÓGICAS INVIOLÁVEIS:
1. QUANTIDADE EXATA: gere exatamente o número de módulos e de aulas por módulo informados no pedido. Se foram pedidos 3 módulos com 3 aulas, o resultado deve ter 3 módulos e 9 aulas, com numeração CONTÍNUA (1 a 3, 4 a 6, 7 a 9). NUNCA crie aulas extras para "fechar" carga horária.
2. total_aulas_efetivas = numero_modulos × aulas_por_modulo.
3. DATAS: quando houver período letivo informado, todas as referências de data devem ficar entre a data inicial e a data final, pulando feriados e a semana acadêmica. Nunca use anos anteriores ou datas fictícias.
4. AVALIAÇÕES: uma avaliação por módulo, marcada no campo "atividades" da última aula do módulo (ex.: "Avaliação 1 do Módulo 1").
5. ESTUDOS DE CASO: distribua os casos sugeridos nas primeiras aulas de cada módulo e liste-os em banco_temas_sugeridos.estudos_de_caso, somente nos módulos em que foram solicitados e na quantidade pedida.
6. CONFIGURAÇÃO INDIVIDUAL POR MÓDULO: o pedido pode definir uma configuração DIFERENTE para cada módulo (quantidade de aulas teóricas, estudos de caso, trabalho acadêmico, caso clínico, atividade extra e avaliações). Respeite rigorosamente a configuração de CADA módulo, sem uniformizar.
7. MÓDULOS PRÁTICOS (SEM AULAS TEÓRICAS): quando o pedido indicar que um módulo NÃO tem aulas teóricas, marque "pratico": true, deixe "aulas" e "etapas" como listas vazias e NÃO crie nenhuma aula expositiva para ele. O "titulo" deve terminar com "(Módulo Prático / Projeto Integrador / Avaliativo)". Preencha "atividades_praticas" com UMA entrada para cada atividade habilitada no módulo (Estudo de Caso, Trabalho Acadêmico e/ou Caso Clínico (SimulSaúde)), descrevendo em "dinamica" detalhadamente como ela ocorre (etapas, papéis dos alunos, entregas, prazos relativos) e em "avaliacao" o instrumento e o peso: a carga horária e a nota desse módulo são compostas EXCLUSIVAMENTE por essas atividades. É PROIBIDO inventar aulas teóricas complementares. Módulos com aulas teóricas devem manter "pratico": false e "atividades_praticas": [].
8. CASO CLÍNICO (SIMULSAÚDE): quando o módulo tiver Caso Clínico habilitado, cite-o explicitamente na coluna "atividades" da aula/etapa correspondente (ex.: "Caso Clínico (SimulSaúde): [tema]") e liste-o em banco_temas_sugeridos.casos_clinicos com o número do módulo. Use o tema informado pelo professor; se não houver tema, proponha um coerente com o conteúdo do módulo.
9. total_aulas_efetivas deve ser a SOMA das aulas teóricas de todos os módulos; aulas_por_modulo pode ser 0 quando a configuração variar entre módulos.
10. CONTEÚDO TÉCNICO REAL: temas, objetivos e conteúdos devem ser específicos da área da disciplina, sem metalinguagem ("conforme a apostila", "nesta aula").
11. BANCO DE TEMAS SUGERIDOS — CATEGORIAS DISTINTAS, SEM REPETIÇÃO:
   - estudos_de_caso: estritamente problemas/casos diagnósticos para DISCUSSÃO EM SALA, baseados no conteúdo do módulo (ex.: "Paciente com hiperglicemia e cetonúria: interpretação do perfil glicêmico"). Objeto {modulo, tema}.
   - casos_clinicos: cenários práticos SIMULADOS para o SimulSaúde, com histórico do paciente, exames e hipótese diagnóstica no campo "cenario" e 2 a 3 objetivos de aprendizagem em "objetivos". Objeto {modulo, tema, objetivos, cenario}.
   - trabalho_academico: tema central delimitado + tipo + objetivos específicos + critérios.
   - atividades_extras: EXCLUSIVAMENTE eventos e dinâmicas — Workshop, Seminário, Debate, Visita Técnica, Aula Prática ou Palestra (ex.: "Workshop de Interpretação de Laudos", "Seminário sobre Inovações Diagnósticas"). É PROIBIDO repetir aqui qualquer estudo de caso ou caso clínico, e é PROIBIDO usar o tipo "Estudo de caso" nesta categoria. Objeto {modulo, tipo, titulo, descricao}.
   - Preencha APENAS as categorias habilitadas na seção "Banco de Temas — categorias habilitadas" do pedido; as demais devem vir como lista vazia [] (ou "" para trabalho_academico). Nunca use temas genéricos ("Tema livre", "A definir").`;

/* ============================================================================
 * Parse seguro + renderização markdown (5 colunas por módulo)
 * ========================================================================== */

export function safeParseLessonPlanJson(raw: string): LessonPlanJson | null {
  const cleaned = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json|javascript)?\s*/i, "")
    .replace(/```\s*$/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try {
    const parsed = LessonPlanJsonSchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function cell(value: string): string {
  return String(value ?? "")
    .replace(/\r?\n+/g, "<br />")
    .replace(/\|/g, "/")
    .trim();
}

/** Sufixo obrigatório no título de módulos sem aulas teóricas. */
export const PRACTICAL_MODULE_SUFFIX = "(Módulo Prático / Projeto Integrador / Avaliativo)";
/** Título do bloco (nível 4) que descreve a dinâmica das atividades do módulo prático. */
export const PRACTICAL_BLOCK_HEADING = "Dinâmica das Atividades Práticas";

/**
 * Atividades práticas de um módulo: usa `atividades_praticas`; se a IA tiver
 * devolvido apenas `etapas` (formato antigo), converte cada etapa em atividade.
 */
function practicalActivitiesOf(mod: LessonPlanJson["modulos"][number]): PracticalActivity[] {
  if (mod.atividades_praticas.length) return mod.atividades_praticas;
  return mod.etapas.map((e) => ({
    tipo: e.etapa || "Atividade prática",
    titulo: e.temas || "",
    objetivos: e.objetivos || "",
    dinamica: [e.conteudo, e.atividades].filter((s) => s && s.trim()).join(" "),
    carga_horaria: "",
    avaliacao: "",
  }));
}

export function renderLessonPlanMarkdown(
  plan: LessonPlanJson,
  clinicalThemes: Array<{ module: number; theme: string }> = [],
  themeBankConfig?: LessonPlanThemeBankConfig,
): string {
  const h = plan.cabecalho;
  const g = plan.informacoes_gerais;
  const out: string[] = [];

  out.push("**PLANO DE AULA**");
  out.push(`**Disciplina:** ${h.disciplina}`);
  out.push(`**Professor(a):** ${h.professor}`);
  out.push(`**Período:** ${h.periodo}`);
  out.push("", "---", "");

  out.push("## Informações Gerais", "");
  out.push(`**Carga Horária:** ${g.carga_horaria}`);
  out.push(`**Nível:** ${g.nivel}`);
  if (g.curso) out.push(`**Curso:** ${g.curso}`);
  if (g.semestre) out.push(`**Semestre:** ${g.semestre}`);
  if (g.ementa) out.push("", `**Ementa:** ${g.ementa}`);
  out.push("");
  out.push(
    `**Estrutura:** ${plan.estrutura_curso.numero_modulos} módulos • ${plan.estrutura_curso.total_aulas_efetivas} aulas efetivas`,
    "",
  );

  out.push("## Cronograma por Módulo", "");
  const practicalSet = new Set((themeBankConfig?.practicalModules ?? []).map(Number));
  plan.modulos.forEach((mod, mi) => {
    const modNumber = parseModuleNumber(mod.titulo) || mi + 1;
    const isPractical =
      practicalSet.has(modNumber) ||
      mod.pratico === true ||
      (!mod.aulas.length && (mod.atividades_praticas.length > 0 || mod.etapas.length > 0));

    if (isPractical) {
      // Módulo exclusivamente prático: sem tabela de aulas convencionais.
      const baseTitle = mod.titulo.replace(/\s*\((m[óo]dulo pr[áa]tico|projeto integrador|avaliativo)[^)]*\)\s*$/i, "").trim();
      out.push(`### ${baseTitle} ${PRACTICAL_MODULE_SUFFIX}`, "");
      out.push(
        "_Módulo sem aulas teóricas: a carga horária e a nota são compostas exclusivamente pelas atividades práticas abaixo._",
        "",
      );
      out.push(`#### ${PRACTICAL_BLOCK_HEADING}`, "");
      const acts = practicalActivitiesOf(mod);
      if (!acts.length) {
        out.push("- Atividades práticas conforme configuração do módulo (Estudo de Caso, Trabalho Acadêmico e/ou Caso Clínico SimulSaúde).");
      }
      for (const a of acts) {
        const head = [a.tipo?.trim(), a.titulo?.trim()].filter(Boolean).join(" — ");
        out.push(`- **${head || "Atividade prática"}**`);
        if (a.objetivos?.trim()) out.push(`Objetivos: ${a.objetivos.trim()}`);
        if (a.dinamica?.trim()) out.push(`Dinâmica: ${a.dinamica.trim()}`);
        if (a.carga_horaria?.trim()) out.push(`Carga horária: ${a.carga_horaria.trim()}`);
        if (a.avaliacao?.trim()) out.push(`Avaliação: ${a.avaliacao.trim()}`);
      }
      out.push("");
      return;
    }

    out.push(`### ${mod.titulo}`, "");
    out.push("| Aula | Tema(s) | Objetivos | Conteúdo | Atividades |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const aula of mod.aulas) {
      out.push(
        `| ${aula.numero} | ${cell(aula.temas)} | ${cell(aula.objetivos)} | ${cell(aula.conteudo)} | ${cell(aula.atividades)} |`,
      );
    }
    for (const etapa of mod.etapas) {
      out.push(
        `| ${cell(etapa.etapa)} | ${cell(etapa.temas)} | ${cell(etapa.objetivos)} | ${cell(etapa.conteudo)} | ${cell(etapa.atividades)} |`,
      );
    }
    if (!mod.aulas.length && !mod.etapas.length) {
      out.push("| — | — | — | — | — |");
    }
    out.push("");
  });

  const at = plan.avaliacoes_trabalhos;
  const configuredTipo = resolveConfiguredWorkType(themeBankConfig);
  const showWork = themeBankConfig ? themeBankConfig.academicWork : true;
  if ((showWork && at?.trabalho_academico) || (at?.avaliacoes?.length ?? 0) > 0) {
    out.push("## Avaliações e Trabalhos", "");
    if (showWork && at?.trabalho_academico) {
      const w = at.trabalho_academico;
      out.push("### Trabalho Acadêmico", "");
      out.push(`**Tipo:** ${configuredTipo || w.tipo}`);
      out.push(`**Lançamento:** ${w.lancamento}`);
      out.push(`**Entrega:** ${w.entrega}`);
      out.push(`**Critérios:** ${w.criterios}`, "");
    }
    if (at?.avaliacoes?.length) {
      out.push("### Avaliações", "");
      out.push("| Avaliação | Tipo | Tipos de Questões | Data Sugerida | Conteúdo |");
      out.push("| --- | --- | --- | --- | --- |");
      for (const a of at.avaliacoes) {
        out.push(
          `| ${cell(a.titulo)} | ${cell(a.tipo)} | ${cell(a.tipos_questoes)} | ${cell(a.data_sugerida)} | ${cell(a.conteudo)} |`,
        );
      }
      out.push("");
    }
  }

  out.push(...renderThemeBankMarkdown(buildLessonPlanThemeBank(plan, clinicalThemes, themeBankConfig)));

  if (plan.referencias_bibliograficas.length) {
    out.push("## Referências Bibliográficas", "");
    for (const r of plan.referencias_bibliograficas) out.push(`• ${r}`);
    out.push("");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Banco de Temas Sugeridos em tópicos categorizados. Cada categoria é um
 * subtítulo "####" seguido de bullets — o exportador PDF transforma cada bloco
 * em uma caixa visual; na tela e no DOCX degrada para subtítulo + lista.
 */
export function renderThemeBankMarkdown(bank: LessonPlanThemeBank): string[] {
  const out: string[] = [];
  const hasAny =
    bank.estudos_de_caso.length ||
    bank.tema_caso_clinico_simulsaude.length ||
    bank.trabalho_academico ||
    bank.atividades_extras.length;
  if (!hasAny) return out;

  const moduleLabel = (n: number, title?: string) =>
    n > 0 ? (title && !/^m[óo]dulo\s*\d+\s*$/i.test(title) ? title : `Módulo ${n}`) : "";

  out.push("## Banco de Temas Sugeridos", "");

  if (bank.estudos_de_caso_detalhe.length) {
    out.push("#### Estudos de Caso Clínico/Laboratorial (por Módulo)", "");
    for (const c of bank.estudos_de_caso_detalhe) {
      const label = moduleLabel(c.modulo, c.modulo_titulo);
      out.push(label ? `• **${label}:** ${c.tema}` : `• ${c.tema}`);
    }
    out.push("");
  }

  if (bank.tema_caso_clinico_simulsaude.length) {
    out.push("#### Casos SimulClínica / SimulSaúde", "");
    for (const c of bank.tema_caso_clinico_simulsaude) {
      const label = moduleLabel(c.modulo, c.modulo_titulo);
      out.push(label ? `• **${label}:** ${c.tema}` : `• ${c.tema}`);
      if (c.objetivos) out.push(`  Objetivos: ${c.objetivos}`);
      if (c.cenario) out.push(`  Cenário: ${c.cenario}`);
    }
    out.push("");
  }

  if (bank.trabalho_academico) {
    const w = bank.trabalho_academico_detalhe;
    out.push("#### Trabalho Acadêmico Semestral", "");
    out.push(`• **Tema central:** ${w?.tema || bank.trabalho_academico}`);
    if (w?.tipo) out.push(`• **Tipo de trabalho:** ${w.tipo}`);
    if (w?.objetivos) out.push(`• **Objetivos específicos:** ${w.objetivos}`);
    if (w?.criterios) out.push(`• **Critérios de avaliação:** ${w.criterios}`);
    out.push("");
  }

  if (bank.atividades_extras.length) {
    out.push("#### Atividades Complementares / Extras", "");
    for (const a of bank.atividades_extras) {
      const label = moduleLabel(a.modulo, a.modulo_titulo);
      const tipo = a.tipo && !/^atividade extra$/i.test(a.tipo) ? `${a.tipo}: ` : "";
      out.push(label ? `• **${label} — ${tipo.replace(/:\s*$/, "") || "Atividade"}:** ${a.titulo}` : `• ${tipo}${a.titulo}`);
      if (a.descricao) out.push(`  ${a.descricao}`);
    }
    out.push("");
  }

  return out;
}

export type LessonPlanThemeBank = {
  /** Compatibilidade: apenas os temas dos estudos de caso. */
  estudos_de_caso: string[];
  estudos_de_caso_detalhe: Array<{ modulo: number; modulo_titulo: string; tema: string }>;
  /** Compatibilidade: tema central do trabalho acadêmico. */
  trabalho_academico: string;
  trabalho_academico_detalhe: (AcademicWorkTheme & { lancamento?: string; entrega?: string }) | null;
  tema_caso_clinico_simulsaude: Array<{
    modulo: number;
    modulo_titulo: string;
    tema: string;
    objetivos?: string;
    cenario?: string;
  }>;
  atividades_extras: Array<{ modulo: number; modulo_titulo: string; tipo: string; titulo: string; descricao: string }>;
};

const EXTRA_ACTIVITY_IN_LESSON_RE =
  /(Semin[áa]rio|Debate|Visita\s+T[ée]cnica|Aula\s+Pr[áa]tica|Workshop|Oficina|Palestra)\s*[:\-–—]\s*([^;.\n]{4,160})/gi;

/**
 * Categorias do Banco de Temas habilitadas no formulário. Categorias não
 * selecionadas pelo(a) professor(a) não entram no documento nem na integração.
 */
export type LessonPlanThemeBankConfig = {
  caseStudies: boolean;
  clinicalCases: boolean;
  academicWork: boolean;
  extraActivities: boolean;
  /**
   * Tipo(s)/formato(s) de trabalho marcados pelo(a) professor(a) no formulário.
   * Quando presente, prevalece sobre o que a IA devolver no campo "tipo".
   */
  academicWorkTypes?: string[];
  /**
   * Números (1-based) dos módulos SEM aulas teóricas. Esses módulos são
   * renderizados como "Módulo Prático / Projeto Integrador / Avaliativo",
   * sem tabela de cronograma de aulas.
   */
  practicalModules?: number[];
};

/** Tipo de trabalho escolhido no formulário (vazio quando não informado). */
export function resolveConfiguredWorkType(config?: LessonPlanThemeBankConfig): string {
  const types = (config?.academicWorkTypes ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  return Array.from(new Set(types)).join(", ");
}

const ALL_CATEGORIES: LessonPlanThemeBankConfig = {
  caseStudies: true,
  clinicalCases: true,
  academicWork: true,
  extraActivities: true,
};

const normKey = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Extrai o banco de temas sugeridos do plano para persistência/integração. */
export function buildLessonPlanThemeBank(
  plan: LessonPlanJson | null,
  clinicalThemes: Array<{ module: number; theme: string }> = [],
  config: LessonPlanThemeBankConfig = ALL_CATEGORIES,
): LessonPlanThemeBank {
  const banco = plan?.banco_temas_sugeridos;
  const moduleTitle = (n: number) => plan?.modulos?.[n - 1]?.titulo ?? (n > 0 ? `Módulo ${n}` : "");
  const clinical: LessonPlanThemeBank["tema_caso_clinico_simulsaude"] = [];

  if (config.clinicalCases) {
    // 1) Temas definidos explicitamente pelo(a) professor(a) no modal.
    for (const item of clinicalThemes) {
      const theme = String(item.theme ?? "").trim();
      if (!theme) continue;
      clinical.push({ modulo: item.module, modulo_titulo: moduleTitle(item.module), tema: theme });
    }

    // 2) Complementa com os temas propostos pela IA (string ou objeto).
    for (const raw of banco?.casos_clinicos ?? []) {
      const c = normalizeClinicalCase(raw);
      if (!c) continue;
      const existing = c.modulo ? clinical.find((x) => x.modulo === c.modulo) : undefined;
      if (existing) {
        // Mantém o tema do professor, mas aproveita objetivos/cenário da IA.
        if (!existing.objetivos && c.objetivos) existing.objetivos = c.objetivos;
        if (!existing.cenario && c.cenario) existing.cenario = c.cenario;
        continue;
      }
      const modulo = c.modulo || clinical.length + 1;
      clinical.push({ modulo, modulo_titulo: moduleTitle(modulo), tema: c.tema, objetivos: c.objetivos, cenario: c.cenario });
    }

    // 3) Casos clínicos definidos dentro de módulos práticos (sem aulas teóricas).
    plan?.modulos?.forEach((mod, mi) => {
      for (const p of mod.atividades_praticas) {
        if (!/caso\s+cl[íi]nico|simul/i.test(p.tipo)) continue;
        const tema = p.titulo.trim();
        if (!tema) continue;
        const existing = clinical.find((x) => x.modulo === mi + 1);
        if (existing) {
          if (!existing.objetivos && p.objetivos?.trim()) existing.objetivos = p.objetivos.trim();
          if (!existing.cenario && p.dinamica?.trim()) existing.cenario = p.dinamica.trim();
          continue;
        }
        if (clinical.some((x) => normKey(x.tema) === normKey(tema))) continue;
        clinical.push({
          modulo: mi + 1,
          modulo_titulo: moduleTitle(mi + 1),
          tema,
          objetivos: p.objetivos?.trim() || undefined,
          cenario: p.dinamica?.trim() || undefined,
        });
      }
    });
  }

  // 3) Estudos de caso (com módulo inferido pelas aulas quando possível).
  const caseStudies: LessonPlanThemeBank["estudos_de_caso_detalhe"] = [];
  const findModuleByLessonActivity = (tema: string): number => {
    if (!plan) return 0;
    const needle = tema.toLowerCase().slice(0, 40);
    for (let mi = 0; mi < plan.modulos.length; mi++) {
      const mod = plan.modulos[mi];
      const rows = [
        ...mod.aulas.map((a) => a.atividades),
        ...mod.etapas.map((e) => e.atividades),
        ...mod.atividades_praticas.map((p) => `${p.tipo} ${p.titulo}`),
      ];
      if (rows.some((r) => String(r ?? "").toLowerCase().includes(needle))) return mi + 1;
    }
    return 0;
  };
  if (config.caseStudies) {
    // Deduplicação por módulo: no máximo 1 estudo de caso por módulo —
    // prevalece o primeiro tema definido (banco da IA antes das etapas práticas).
    const hasModuleCase = (modulo: number) =>
      modulo > 0 && caseStudies.some((x) => x.modulo === modulo);
    for (const raw of banco?.estudos_de_caso ?? []) {
      const c = normalizeCaseStudy(raw);
      if (!c) continue;
      const modulo = c.modulo || findModuleByLessonActivity(c.tema);
      if (caseStudies.some((x) => normKey(x.tema) === normKey(c.tema))) continue;
      if (hasModuleCase(modulo)) continue;
      caseStudies.push({ modulo, modulo_titulo: moduleTitle(modulo), tema: c.tema });
    }
    // Estudos de caso definidos dentro de módulos práticos (sem aulas teóricas).
    plan?.modulos?.forEach((mod, mi) => {
      for (const p of mod.atividades_praticas) {
        if (!/estudo\s+de\s+caso/i.test(p.tipo)) continue;
        const tema = p.titulo.trim();
        if (!tema || caseStudies.some((x) => normKey(x.tema) === normKey(tema))) continue;
        if (hasModuleCase(mi + 1)) continue;
        caseStudies.push({ modulo: mi + 1, modulo_titulo: moduleTitle(mi + 1), tema });
      }
    });
  }

  // 4) Trabalho acadêmico (tema + tipo + objetivos + critérios).
  //    O tipo marcado no formulário prevalece sobre o que a IA devolver —
  //    elimina o fallback indevido para "Artigo Científico".
  const at = config.academicWork ? plan?.avaliacoes_trabalhos?.trabalho_academico : undefined;
  const configuredTipo = resolveConfiguredWorkType(config);
  const work = config.academicWork
    ? normalizeAcademicWork(banco?.trabalho_academico ?? "", at?.tipo ?? "", at?.criterios ?? "")
    : null;
  if (work && configuredTipo) work.tipo = configuredTipo;
  const workDetail = work
    ? { ...work, lancamento: at?.lancamento, entrega: at?.entrega }
    : at?.tipo || configuredTipo
      ? { tema: "", tipo: configuredTipo || at?.tipo || "", objetivos: "", criterios: at?.criterios ?? "", lancamento: at?.lancamento, entrega: at?.entrega }
      : null;

  // 5) Atividades extras: bloco dedicado + menções nas colunas "atividades".
  //    Nunca repetem estudos de caso nem casos clínicos — reservadas a eventos
  //    (seminário, debate, workshop, visita técnica, aula prática, palestra).
  const extras: LessonPlanThemeBank["atividades_extras"] = [];
  const reserved = new Set<string>([
    ...caseStudies.map((c) => normKey(c.tema)),
    ...clinical.map((c) => normKey(c.tema)),
  ]);
  const isCaseLike = (tipo: string, titulo: string) =>
    /estudo\s+de\s+caso|caso\s+cl[íi]nico|simul/i.test(tipo) || /^(estudo\s+de\s+)?caso\s+cl[íi]nico/i.test(titulo);
  const pushExtra = (e: ExtraActivityTheme | null) => {
    if (!e) return;
    const key = normKey(e.titulo);
    if (!key || reserved.has(key)) return;
    if (isCaseLike(e.tipo, e.titulo)) return;
    if (extras.some((x) => normKey(x.titulo) === key)) return;
    extras.push({ modulo: e.modulo, modulo_titulo: moduleTitle(e.modulo), tipo: e.tipo, titulo: e.titulo, descricao: e.descricao });
  };
  if (config.extraActivities) {
    for (const raw of banco?.atividades_extras ?? []) pushExtra(normalizeExtraActivity(raw));
    if (plan) {
      plan.modulos.forEach((mod, mi) => {
        const rows = [...mod.aulas.map((a) => a.atividades), ...mod.etapas.map((e) => e.atividades)];
        for (const row of rows) {
          const text = String(row ?? "");
          let m: RegExpExecArray | null;
          EXTRA_ACTIVITY_IN_LESSON_RE.lastIndex = 0;
          while ((m = EXTRA_ACTIVITY_IN_LESSON_RE.exec(text)) !== null) {
            pushExtra({ modulo: mi + 1, tipo: m[1].trim(), titulo: m[2].trim(), descricao: "" });
          }
        }
        // Atividades complementares de módulos práticos (seminário, workshop, visita…).
        // Estudos de caso / casos clínicos / trabalho são filtrados por `isCaseLike`
        // e pelo conjunto `reserved`, evitando duplicidade no Banco de Temas.
        for (const p of mod.atividades_praticas) {
          if (/trabalho\s+acad/i.test(p.tipo)) continue;
          pushExtra({
            modulo: mi + 1,
            tipo: p.tipo.trim(),
            titulo: p.titulo.trim(),
            descricao: [p.objetivos, p.dinamica].filter((s) => s && s.trim()).join(" — "),
          });
        }
      });
    }
  }

  return {
    estudos_de_caso: caseStudies.map((c) => c.tema),
    estudos_de_caso_detalhe: caseStudies,
    trabalho_academico: work?.tema || at?.tipo || "",
    trabalho_academico_detalhe: workDetail,
    tema_caso_clinico_simulsaude: clinical.sort((a, b) => a.modulo - b.modulo),
    atividades_extras: extras.sort((a, b) => a.modulo - b.modulo),
  };
}

export async function generateLessonPlanDocument(params: {
  prompt: string;
  extraContext?: string;
  clinicalThemes?: Array<{ module: number; theme: string }>;
  themeBankConfig?: LessonPlanThemeBankConfig;
}): Promise<{ markdown: string; themeBank: LessonPlanThemeBank }> {
  try {
    const validated = LessonPlanInputSchema.parse(params);

    const fullPrompt = validated.extraContext
      ? `Tema/Objetivos: ${validated.prompt}\nContexto adicional: ${validated.extraContext}`
      : validated.prompt;

    const rawResult = await callAIText({
      system: LESSON_PLAN_JSON_SYSTEM,
      user: fullPrompt,
      model: "google/gemini-2.5-flash",
      maxTokens: 16000,
      temperature: 0.4,
    });

    if (!rawResult || rawResult.trim().length < 40) {
      throw new Error("A IA retornou uma resposta vazia ou incompleta. Tente novamente.");
    }

    const plan = safeParseLessonPlanJson(rawResult);
    if (plan) {
      return {
        markdown: renderLessonPlanMarkdown(plan, params.clinicalThemes ?? [], params.themeBankConfig),
        themeBank: buildLessonPlanThemeBank(plan, params.clinicalThemes ?? [], params.themeBankConfig),
      };
    }

    // Fallback: mantém o plano utilizável mesmo se o JSON vier malformado.
    const unfenced = rawResult
      .replace(/^\s*```(?:markdown|md|json|text)?\s*/i, "")
      .replace(/```\s*$/g, "")
      .trim();
    // Nunca devolvemos o JSON cru como "plano": isso salvaria um bloco de código
    // no lugar do documento. Se o conteúdo ainda parece JSON, falhamos com aviso.
    if (/^[{[]/.test(unfenced)) {
      throw new Error("A IA não retornou um plano legível. Tente gerar novamente.");
    }
    const sanitized = sanitizeLessonPlanMarkdown(unfenced);
    if (sanitized.trim().length < 40) {
      throw new Error("A IA não retornou um plano válido. Tente novamente.");
    }
    return {
      markdown: sanitized,
      themeBank: buildLessonPlanThemeBank(null, params.clinicalThemes ?? [], params.themeBankConfig),
    };
  } catch (error) {
    console.error("[generateLessonPlanDocument] Error:", error);
    if (error instanceof z.ZodError) throw new Error("Parâmetros de entrada inválidos.");
    throw error instanceof Error ? error : new Error("Erro desconhecido ao gerar o plano.");
  }
}

export async function generateLessonPlanLogic(params: {
  prompt: string;
  extraContext?: string;
}) {
  const { markdown } = await generateLessonPlanDocument(params);
  return markdown;
}

