/**
 * Generic sanitizer for user/AI/imported content shown in lists
 * (lesson titles, topics, syllabus items, material names, etc.).
 */

/**
 * Sanitizes a topic/module/lesson label before injecting it into an AI prompt.
 * - Removes stray punctuation/loose characters at the edges (e.g. "Gestão,?" -> "Gestão")
 *   and collapses repeated whitespace.
 * - Blocks empty generic placeholders ("Disciplina", "Módulo", "Matéria", "geral", ...)
 *   by returning "" so callers fall back to the real lesson/handbook content.
 */
export function sanitizeAssessmentTopic(rawTopic: string): string {
  if (typeof rawTopic !== "string" || !rawTopic.trim()) return "";

  // Linhas de metadados do cabeçalho da apostila ("Professor(a): ...",
  // "Instituição: ...", "Turno: ...", "Data: ...") nunca viram conceito —
  // rejeitamos a linha inteira em vez de aproveitar o valor após os dois-pontos.
  if (HEADER_METADATA_LINE_RE.test(rawTopic.replace(/^[#>*_`\s]+/, ""))) return "";

  // O limite de palavra (\\b) e o separador obrigatório são intencionais:
  // removem "Aula 1: " sem nunca consumir o início de uma palavra técnica.
  // Ex.: "Aula 1: Farmacologia" -> "Farmacologia" e "Farmacologia" permanece
  // exatamente igual, sem ser reduzida a "F".
  const structuralPrefix = /^(?:m[óo]dulo|aula|unidade|cap[íi]tulo|disciplina|tema|bloco|t[óo]pico)s?\b\s*\d*(?:\.\d+)*\s*(?:[-:–—.)]+)\s+/iu;
  const clean = rawTopic
    .replace(/^[#>*_`]+|[#>*_`]+$/g, "")
    .replace(structuralPrefix, "")
    .replace(/^[\s,.;:?!_/\-–—]+|[\s,.;:?!_/\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Bloqueia somente placeholders genéricos completos; nomenclaturas técnicas
  // compostas, siglas e termos de uma única palavra são preservados integralmente.
  const forbiddenPatterns = [
    /^(disciplina|disciplinas|modulo|módulo|módulos|modulos|materia|matéria|assunto|assuntos|conteudo|conteúdo|conteúdos|conteudos|aula|aulas|unidade|unidades|ementa|apostila|geral|tema|temas|topico|tópico|tópicos|topicos|professor|professora|professor\(a\)|prof|prof\.|institui[çc][ãa]o|turno|data|curso)$/iu,
    /^(sem-modulo|sem-disciplina|geral)$/iu,
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(clean)) ? "" : clean;
}

/**
 * Rótulos de cabeçalho estrutural que nunca podem virar tópico/conceito,
 * mesmo quando seguidos de um valor ("Professor(a): Fulano", "Módulo 2:").
 */
const HEADER_METADATA_LINE_RE =
  /^(?:disciplina|professor(?:\(a\)|a)?|prof\.?|institui[çc][ãa]o|instituicao|turno|data|curso|per[íi]odo|semestre|carga\s+hor[áa]ria)\s*:/iu;


/**
 * Sanitizes AI-generated question/option/explanation text before persistence.
 * Removes space before punctuation ("termo ?" -> "termo?"), comma glued to a
 * question mark ("Gestão,?" -> "Gestão?"), duplicated question marks, and trims.
 */
export function sanitizeGeneratedQuestionText(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/\s+([,.;?!:])/g, "$1") // Remove espaço antes de pontuação (ex: "termo ?" -> "termo?")
    .replace(/[,;:]\?/g, "?")         // Remove vírgula/ponto e vírgula colados na interrogação (ex: "Gestão,?" -> "Gestão?")
    .replace(/\?{2,}/g, "?")          // Remove interrogações duplicadas
    .trim();
}

/**
 * Removes redundant repeated option-letter prefixes produced by the model
 * (e.g. "A) A) Farmácia" -> "A) Farmácia", "a) b. texto" -> "a) texto").
 */
/**
 * Remove citações estáticas à letra da alternativa correta no início da
 * justificativa/explicação (ex: "A alternativa correta é a C.", "A resposta
 * correta é a letra B -", "Alternativa correta: C —"). A letra muda após a
 * randomização das versões, então o texto comentado deve conter apenas a
 * explicação conceitual.
 */
export function stripHardcodedCorrectLetter(text: string): string {
  if (!text) return "";
  let t = String(text).trim();
  // A letra do gabarito só é removida quando é realmente uma letra isolada
  // (seguida de pontuação, espaço final ou fim do texto) — nunca a primeira
  // letra de uma palavra como "definição", "afirmação" ou "cálculo".
  const re =
    /^\s*\*{0,2}\s*[([]?\s*(?:a\s+)?(?:alternativa|resposta|op[cç][aã]o)\s+(?:correta|certa)\s*\*{0,2}\s*(?:[ée](?:\s+a(?:\s+letra)?)?|:|-)\s*(?:letra\s+)?\*{0,2}([a-eA-E])\*{0,2}(?=\s*(?:[)\].:;,\-–—]|$))\s*[)\].:;\-–—]*\s*/i;
  // Aplica até 2 vezes (ex: "A alternativa correta é a C. Alternativa correta: C - texto")
  for (let i = 0; i < 2 && re.test(t); i++) t = t.replace(re, "").trim();
  return t;
}

export function dedupeOptionPrefixes(text: string): string {
  if (!text) return "";
  const PREFIX = "\\s*[a-eA-E]\\s*[).:\\-]";
  const re = new RegExp(`^(${PREFIX})+`);
  const match = String(text).match(re);
  if (!match) return String(text).trim();
  // Keep only the first prefix, drop the redundant ones.
  const first = match[0].match(new RegExp(PREFIX))?.[0] ?? "";
  const rest = String(text).slice(match[0].length);
  return `${first.trim()}${rest.startsWith(" ") || !first ? "" : " "}${rest}`.replace(/\s+/g, " ").trim();
}

/**
 * Prefixos estruturais no início do rótulo ("Módulo 2:", "Aula 01 -",
 * "Disciplina:", "Capítulo 3 —"). Removidos preservando palavras inteiras.
 */
const STRUCTURAL_PREFIX_RE =
  /^(?:m[óo]dulo|aula|unidade|cap[íi]tulo|disciplina|tema|bloco|t[óo]pico)s?\b\s*\d*(?:\.\d+)*\s*(?:[-:–—.)]+)\s+/iu;

/**
 * Sanitizes a concept/topic string before injecting it into an AI prompt.
 * Prefixes are removed only at a complete-word boundary and technical names
 * are never shortened, even when they contain one word.
 */
export function sanitizeConceptTopic(topic: string): string {
  if (typeof topic !== "string" || !topic.trim()) return "";
  const base = topic
    .replace(/\s+/g, " ")
    .trim()
    .replace(STRUCTURAL_PREFIX_RE, "")
    .replace(/[,;:.?!]+$/, "")
    .replace(/,\s*\?/g, "?")
    .replace(/^["'|\[\]$]+|["'|\[\]$]+$/g, "")
    .trim();
  return sanitizeAssessmentTopic(base);
}


/**
 * Termos estruturais/cabeçalhos que NUNCA podem virar "conceito central"
 * de uma questão (são rótulos de organização do material, não conteúdo).
 */
export const STRUCTURAL_STOPWORDS = [
  "disciplina", "disciplinas", "conteúdo", "conteudo", "conteúdos", "conteudos",
  "tema", "temas", "assunto", "assuntos", "módulo", "modulo", "módulos", "modulos",
  "aula", "aulas", "unidade", "unidades", "ementa", "ementas", "apostila", "apostilas",
  "geral", "material", "materiais", "matéria", "materia", "capítulo", "capitulo",
  "tópico", "topico", "tópicos", "topicos", "sumário", "sumario",
  "professor", "professora", "professores", "prof", "instituição", "instituicao",
  "turno", "data", "curso", "cursos", "período", "periodo", "semestre",
  // Termos vagos/estruturais que aparecem em cabeçalhos e rodapés da apostila e
  // nunca representam um conceito técnico substantivo por si sós.
  "resultado", "resultados", "contexto", "contextos",
  "análise", "analise", "análises", "analises",
  "evidência", "evidencia", "evidências", "evidencias",
  "caso prático", "caso pratico", "casos práticos", "casos praticos",
  "processo", "processos", "objetivo", "objetivos", "introdução", "introducao",
  "conclusão", "conclusao", "referências", "referencias", "atividade", "atividades",
];


const STRUCTURAL_SET = new Set(STRUCTURAL_STOPWORDS.map((w) => w.toLocaleLowerCase("pt-BR")));


/** Rótulo estrutural com numeração/dois-pontos e sem conteúdo substantivo. */
const STRUCTURAL_HEADER_RE = new RegExp(
  `^(?:${STRUCTURAL_STOPWORDS.join("|")})\\s*(?:\\d+(?:\\.\\d+)*)?\\s*[:.\\-–—)]*$`,
  "i",
);

/**
 * true quando o texto é apenas um rótulo estrutural ("Disciplina:", "Aula 2",
 * "Módulo 3 —", "Ementa") e não um conceito real ("Farmacotécnica").
 */
export function isStructuralConceptLabel(raw: unknown): boolean {
  const clean = String(raw ?? "")
    .replace(/[*_`#]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:?!_/\-–—]+|[\s,.;:?!_/\-–—]+$/g, "")
    .trim();
  if (!clean) return true;
  // "Professor(a): Fulano", "Instituição: X", "Turno: Noite", "Data: 10/03"
  if (HEADER_METADATA_LINE_RE.test(clean)) return true;
  const lower = clean.toLocaleLowerCase("pt-BR");
  if (STRUCTURAL_SET.has(lower)) return true;
  if (STRUCTURAL_HEADER_RE.test(lower)) return true;

  // "Aula 2:", "Módulo 1 -", "Tema 3" (só rótulo + número)
  if (/^(?:\d+(?:\.\d+)*[.)]?\s*)?[\p{L}]+\s*\d+(?:\.\d+)*\s*[:.\-–—)]*$/u.test(lower)) {
    const head = lower.split(/[\s\d]/)[0];
    if (STRUCTURAL_SET.has(head)) return true;
  }
  return false;
}

/**
 * Higieniza um conceito extraído da apostila/plano de aula. Retorna "" quando
 * o texto é um rótulo estrutural (para o chamador aplicar o fallback real).
 */
export function sanitizeExtractedConcept(raw: unknown, fallbackText?: string | null): string {
  const clean = sanitizeConceptTopic(String(raw ?? ""));
  const valid = clean && !isStructuralConceptLabel(clean) && clean.replace(/[^\p{L}\p{N}]/gu, "").length >= 3
    ? clean
    : "";
  if (valid) return valid;
  // Conceitos degenerados ("F", "Aula 2") usam o subtítulo/parágrafo como
  // fallback, sem tentar reconstruir ou truncar a nomenclatura original.
  if (fallbackText) {
    const alt = sanitizeConceptTopic(String(fallbackText));
    if (alt && !isStructuralConceptLabel(alt) && alt.replace(/[^\p{L}\p{N}]/gu, "").length >= 3) return alt;
  }
  return "";
}


/** Remove rótulos estruturais e duplicatas de uma lista de conceitos. */
export function filterConceptList(items: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = sanitizeExtractedConcept(item);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Fallback inteligente: se a lista de conceitos ficar vazia após o filtro,
 * usa o título real da aula e, por último, o nome da disciplina — nunca um
 * rótulo genérico.
 */
export function resolveConceptFallback(
  concepts: unknown[],
  lessonTitle?: string | null,
  disciplineName?: string | null,
): string[] {
  const filtered = filterConceptList(concepts);
  if (filtered.length > 0) return filtered;
  const fallback = filterConceptList([lessonTitle ?? "", disciplineName ?? ""]);
  return fallback;
}



const SMALL_WORDS = new Set([
  "a","à","às","ao","aos","as","o","os","da","das","de","do","dos","e","em","na","nas","no","nos",
  "por","para","com","sem","sob","sobre","um","uma","uns","umas","ou","que","se","the","of","and","in","to",
]);

/** Title-cases a phrase while keeping acronyms and Portuguese small words natural. */
export function toReadableCase(input: string): string {
  return input
    .split(/\s+/)
    .map((word, index) => {
      if (!word) return word;
      // Preserve acronyms / codes (SUS, HIV, ECG, CID-10), ignoring trailing punctuation
      const core = word.replace(/[.,;:!?)]+$/, "");
      if (/^[A-Z0-9][A-Z0-9\-./]*$/.test(core) && core.length >= 2 && core.length <= 6) return word;
      const lower = word.toLocaleLowerCase("pt-BR");
      if (index > 0 && SMALL_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
      return lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

/**
 * Cleans bullets, markdown noise, raw separators and stray punctuation from a
 * list item, optionally preserving a "Aula X:" style prefix.
 */
export function sanitizeListTitle(raw: unknown, options: { titleCase?: boolean } = {}): string {
  const { titleCase = true } = options;
  let text = String(raw ?? "");

  // Strip markdown emphasis, headings and leading bullets/dashes/numbering
  text = text.replace(/[*_`#]+/g, " ");
  text = text.replace(/^[\s\u2022\u2023\u25E6\u2043\u2219•·◦*\-–—>]+/, " ");
  // Bullets appearing mid-string become commas
  text = text.replace(/\s*[\u2022•·◦]\s*/g, ", ");
  // Raw separators become fluid connectors
  text = text.replace(/\s*[/;|]\s*/g, ", ");
  // Normalize dashes used as separators
  text = text.replace(/\s+[–—]\s+/g, ", ");
  // Collapse whitespace and duplicated punctuation
  text = text.replace(/\s+/g, " ");
  text = text.replace(/([,.;:])\1+/g, "$1");
  text = text.replace(/\s+([,.;:])/g, "$1");
  text = text.replace(/,\s*,+/g, ", ");
  text = text.trim();
  // Trim stray punctuation on the edges
  text = text.replace(/^[,.;:\-–—\s]+/, "").replace(/[,;:\-–—\s]+$/, "").trim();

  // Preserve a "Aula 3:" / "Tema 2 -" style prefix and sanitize only the body
  const prefixMatch = text.match(/^((?:\d+(?:\.\d+)*[.)]?\s*)?(?:aula|módulo|modulo|tema|unidade|capítulo|capitulo)\s*\d+(?:\.\d+)*)\s*[:\-–—]?\s*(.*)$/i);
  if (prefixMatch) {
    const label = prefixMatch[1].replace(/\s+/g, " ").trim();
    const normalizedLabel = label.replace(/^(\d+(?:\.\d+)*[.)]?\s*)?(\p{L}+)/u, (_m, num = "", word: string) =>
      `${num ?? ""}${word.toLocaleLowerCase("pt-BR").replace(/^\p{L}/u, (c) => c.toLocaleUpperCase("pt-BR"))}`,
    );
    const body = prefixMatch[2].replace(/^[,.;:\-–—\s]+/, "").trim();
    if (!body) return normalizedLabel;
    return `${normalizedLabel}: ${titleCase ? toReadableCase(body) : body}`;
  }

  if (!text) return "";
  return titleCase ? toReadableCase(text) : text;
}

/** Sanitizes and de-duplicates a list of titles, dropping empty entries. */
export function sanitizeTitleList(items: unknown[], options?: { titleCase?: boolean }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = sanitizeListTitle(item, options);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Frases conversacionais/metatexto que a IA às vezes devolve antes da lista de
 * temas ("Aqui estão 5 temas curtos e criativos...", "Claro! Segue...").
 * Nunca podem virar título de caso clínico ou de trabalho acadêmico.
 */
const AI_PREAMBLE_RE =
  /^(?:claro|certo|com certeza|perfeito|ol[áa]|segue[m]?|aqui\s+(?:est[áã]o|v[ãa]o|seguem)|abaixo|a\s+seguir|espero\s+que|sugest[õo]es?\s+de\s+temas?|temas?\s+sugeridos?|lista\s+de\s+temas?)\b/i;

const AI_PREAMBLE_SENTENCE_RE =
  /\b(?:tema|temas|sugest[õo]es?|op[çc][õo]es?|t[íi]tulos?)\b[^.!?\n]*\b(?:curtos?|criativos?|sugerid[oa]s?|para\s+(?:um|uma)\s+(?:trabalho|caso))\b/i;

/** true quando a linha é apenas conversa/instrução da IA, não um tema real. */
export function isAIConversationalLine(raw: unknown): boolean {
  const text = String(raw ?? "").replace(/^[#>*_`\-\s\d.)]+/, "").trim();
  if (!text) return true;
  if (AI_PREAMBLE_RE.test(text)) return true;
  if (AI_PREAMBLE_SENTENCE_RE.test(text)) return true;
  // Frases terminadas em ":" costumam ser introdução da lista.
  if (/:\s*$/.test(text) && text.split(/\s+/).length <= 14) return true;
  return false;
}

/**
 * Converte o retorno (possivelmente cru) da IA em um título clínico/acadêmico
 * direto: descarta preâmbulos conversacionais, escolhe o primeiro tema válido
 * de uma lista, remove numeração/aspas/markdown e limita o tamanho.
 */
export function sanitizeAITitle(raw: unknown, maxLength = 300): string {
  const source = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  const candidates = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of candidates) {
    if (isAIConversationalLine(line)) continue;
    let text = line
      .replace(/^[#>*_`]+/, "")
      .replace(/^[-–—•·]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/[*_`]/g, "")
      .replace(/^["“'‘]+|["”'’]+$/g, "")
      .trim();
    // Remove rótulos residuais ("Tema:", "Título do caso:", "Caso clínico:")
    text = text.replace(/^(?:tema|t[íi]tulo(?:\s+do\s+caso)?|caso(?:\s+cl[íi]nico)?|sugest[ãa]o)\s*[:\-–—]\s*/i, "").trim();
    if (!text || isAIConversationalLine(text)) continue;
    // Se o tema vier com explicação após um ponto final longo, mantém a 1ª frase.
    if (text.length > maxLength) {
      const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.trim();
      text = (firstSentence && firstSentence.length <= maxLength ? firstSentence : text.slice(0, maxLength)).trim();
    }
    text = text.replace(/[,;:\-–—\s]+$/, "").trim();
    if (text.length >= 3) return text;
  }
  return "";
}
