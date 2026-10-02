/**
 * Robust question parser for AI-generated exercise/assessment lists.
 *
 * Accepts Markdown, plain text or JSON and returns structured questions.
 * Question dividers recognized: "Questão X", "### Questão X", "X)", "X.",
 * "**Questão X**", "QUESTAO X".
 * Option prefixes recognized: "a)", "A.", "(a)", "a -", "a:".
 * Answer key lines recognized: "Gabarito: A", "Resposta correta: A",
 * "Resposta: A", "Alternativa correta: A".
 */

export interface ParsedQuestion {
  prompt: string;
  options: string[];
  /** Index of the correct option, or -1 when it could not be inferred. */
  correctIndex: number;
  explanation: string;
}

const LETTERS = ["a", "b", "c", "d", "e", "f"];

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*>+\s?/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .trim();
}

const QUESTION_RE =
  /^(?:#{1,6}\s*)?(?:quest[aã]o|q|item)\s*[nº#]?\s*(\d{1,3})\s*[).:\-–—]?\s*(.*)$/i;
const NUMBERED_RE = /^(\d{1,3})\s*[).:\-–—]\s*(.*)$/;
const OPTION_RE = /^\(?\s*([a-fA-F])\s*\)?\s*[).:\-–—]\s*(.+)$/;
const LABEL_RE = /^(?:alternativas|op[cç][oõ]es)\s*[:\-–—]?\s*$/i;
const ANSWER_RE =
  /^(?:gabarito|resposta\s+correta|resposta|alternativa\s+correta|op[cç][aã]o\s+correta|correta)\s*[:\-–—]?\s*\(?\s*([a-fA-F])\s*\)?\s*\.?\s*$/i;
const ANSWER_INLINE_RE =
  /(?:gabarito|resposta\s+correta|resposta|alternativa\s+correta|op[cç][aã]o\s+correta)\s*[:\-–—]?\s*\(?\s*([a-fA-F])\s*\)?/i;
const EXPLANATION_RE =
  /^(?:explica[cç][aã]o|coment[aá]rio|justificativa|feedback)\s*[:\-–—]?\s*(.*)$/i;


function letterToIndex(letter: string | undefined | null): number {
  if (!letter) return -1;
  const idx = LETTERS.indexOf(letter.toLowerCase());
  return idx;
}

const STOP_WORDS = new Set([
  "a","o","as","os","um","uma","de","do","da","dos","das","e","ou","que","para","por","com",
  "no","na","nos","nas","em","ao","aos","se","sua","seu","suas","seus","este","esta","isso",
  "correta","alternativa","opcao","opção","letra","porque","pois","sendo","como","mais","menos",
  "ser","é","sao","são","tem","têm","pela","pelo","dessa","desse","entre","sobre",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

/**
 * Tries to infer the correct option from an explanation text.
 * Order: explicit letter reference -> verbatim option text ->
 * best keyword overlap, weighting the first sentence of the explanation.
 */
function inferFromExplanation(explanation: string, options: string[]): number {
  if (!explanation || options.length === 0) return -1;
  const inline = explanation.match(
    /alternativa\s*\(?\s*([a-eA-E])\s*\)?|letra\s*\(?\s*([a-eA-E])\s*\)?|op[cç][aã]o\s*\(?\s*([a-eA-E])\s*\)?/,
  );
  const letter = inline?.[1] || inline?.[2] || inline?.[3];
  const byLetter = letterToIndex(letter);
  if (byLetter >= 0 && byLetter < options.length) return byLetter;

  // Verbatim match of the option text inside the explanation.
  const normalized = explanation.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    const text = options[i].toLowerCase().replace(/[.;:]+$/, "");
    if (text.length >= 15 && normalized.includes(text.slice(0, Math.min(60, text.length))))
      return i;
  }

  // Keyword overlap: the first sentence of the explanation usually restates
  // the correct statement (ex.: "O timo é o órgão..." -> option about o timo).
  const firstSentence = explanation.split(/(?<=[.!?])\s+/)[0] ?? explanation;
  const firstTokens = new Set(tokens(firstSentence));
  const allTokens = new Set(tokens(explanation));
  let best = -1;
  let bestScore = 0;
  let runnerUp = 0;
  for (let i = 0; i < options.length; i++) {
    const optTokens = tokens(options[i]);
    if (optTokens.length === 0) continue;
    let score = 0;
    for (const t of new Set(optTokens)) {
      if (firstTokens.has(t)) score += 2;
      else if (allTokens.has(t)) score += 1;
    }
    const ratio = score / optTokens.length;
    if (ratio > bestScore) {
      runnerUp = bestScore;
      bestScore = ratio;
      best = i;
    } else if (ratio > runnerUp) {
      runnerUp = ratio;
    }
  }
  // Require a clear winner to avoid guessing at random.
  if (best >= 0 && bestScore >= 0.5 && bestScore > runnerUp * 1.25) return best;
  return -1;
}


function fromJsonLike(value: unknown): ParsedQuestion[] | null {
  const arr = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? ((value as Record<string, unknown>)["questions"] as unknown[]) ??
        ((value as Record<string, unknown>)["questoes"] as unknown[]) ??
        null
      : null;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out: ParsedQuestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    const prompt = String(q["prompt"] ?? q["enunciado"] ?? q["question"] ?? "").trim();
    let options: string[] = [];
    const optRaw = q["options"] ?? q["alternativas"] ?? q["alternatives"];
    if (Array.isArray(optRaw)) options = optRaw.map((o) => String(o ?? "").trim());
    else if (optRaw && typeof optRaw === "object") {
      const map = optRaw as Record<string, unknown>;
      options = LETTERS.map((l) => map[l] ?? map[l.toUpperCase()])
        .filter((v) => v != null)
        .map((v) => String(v).trim());
    }
    if (!prompt && options.length === 0) continue;
    const explanation = String(q["explanation"] ?? q["explicacao"] ?? "").trim();
    const answerRaw = q["correct_answer"] ?? q["gabarito"] ?? q["answer"] ?? q["correctIndex"];
    let correctIndex = -1;
    if (typeof answerRaw === "number") correctIndex = answerRaw;
    else if (typeof answerRaw === "string") {
      const trimmed = answerRaw.trim();
      if (/^[a-fA-F]$/.test(trimmed)) correctIndex = letterToIndex(trimmed);
      else {
        const found = options.findIndex(
          (o) => o.toLowerCase() === trimmed.toLowerCase(),
        );
        correctIndex = found;
      }
    }
    if (correctIndex < 0 || correctIndex >= options.length)
      correctIndex = inferFromExplanation(explanation, options);
    out.push({ prompt, options: options.map(stripOptionPrefix), correctIndex, explanation });
  }
  return out.length ? out : null;
}

export function stripOptionPrefix(value: string): string {
  return value.replace(/^\(?\s*[a-fA-F]\s*\)?\s*[).:\-–—]\s*/, "").trim();
}

/**
 * Parses questions from any supported representation (JSON, Markdown, plain text).
 */
export function parseQuestionsFromText(input: unknown): ParsedQuestion[] {
  if (input && typeof input === "object") {
    const fromObj = fromJsonLike(input);
    if (fromObj) return fromObj;
  }
  let text = typeof input === "string" ? input : "";
  if (!text && input && typeof input === "object") {
    const content = (input as Record<string, unknown>)["content"];
    if (typeof content === "string") text = content;
  }
  if (!text.trim()) return [];

  const fenced = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
  if (fenced.startsWith("{") || fenced.startsWith("[")) {
    try {
      const parsed = fromJsonLike(JSON.parse(fenced));
      if (parsed) return parsed;
    } catch {
      /* fall through to text parsing */
    }
  }

  const lines = text.split(/\r?\n/).map(stripMarkdown);
  type Draft = { prompt: string[]; options: string[]; answerLetter: string | null; explanation: string[] };
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let mode: "prompt" | "options" | "explanation" = "prompt";

  const startQuestion = (firstText: string): Draft => {
    const draft: Draft = {
      prompt: firstText ? [firstText] : [],
      options: [],
      answerLetter: null,
      explanation: [],
    };
    drafts.push(draft);
    mode = "prompt";
    return draft;
  };


  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-=_*]{3,}$/.test(line)) continue;

    const qMatch = line.match(QUESTION_RE);
    if (qMatch) {
      current = startQuestion(qMatch[2]?.trim() ?? "");
      continue;
    }
    const nMatch = line.match(NUMBERED_RE);
    // "1) ..." inicia questão quando é sequencial ou quando não estamos
    // no meio das alternativas (evita roubar itens numerados do enunciado).
    if (nMatch && (Number(nMatch[1]) === drafts.length + 1 || mode === "prompt")) {
      current = startQuestion(nMatch[2]?.trim() ?? "");
      continue;
    }
    if (!current) {
      // Ignore preamble (titles, headers) until a question starts.
      continue;
    }
    if (LABEL_RE.test(line)) {
      mode = "options";
      continue;
    }
    const aMatch = line.match(ANSWER_RE);
    if (aMatch) {
      current.answerLetter = aMatch[1];
      mode = "explanation";
      continue;
    }
    const eMatch = line.match(EXPLANATION_RE);
    if (eMatch) {
      // Answer key may be embedded in the explanation line.
      if (!current.answerLetter) {
        const inline = line.match(ANSWER_INLINE_RE);
        if (inline) current.answerLetter = inline[1];
      }
      if (eMatch[1]?.trim()) current.explanation.push(eMatch[1].trim());
      mode = "explanation";
      continue;
    }
    const oMatch = mode !== "explanation" ? line.match(OPTION_RE) : null;
    if (oMatch) {
      current.options.push(oMatch[2].trim());
      mode = "options";
      continue;
    }
    if (!current.answerLetter) {
      const inlineAnswer = line.match(ANSWER_INLINE_RE);
      if (inlineAnswer) current.answerLetter = inlineAnswer[1];
    }
    if (mode === "explanation") current.explanation.push(line);
    else if (mode === "options" && current.options.length)
      current.options[current.options.length - 1] += ` ${line}`;
    else current.prompt.push(line);
  }

  const result: ParsedQuestion[] = [];
  for (const d of drafts) {
    const prompt = d.prompt.join(" ").replace(/\s+/g, " ").trim();
    const options = d.options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Tolerante: mantém a questão mesmo sem alternativas/gabarito completos,
    // para que o professor possa conferir e editar no modal.
    if (!prompt && options.length === 0) continue;
    const explanation = d.explanation.join(" ").replace(/\s+/g, " ").trim();
    let correctIndex = letterToIndex(d.answerLetter);
    if (correctIndex < 0 || correctIndex >= options.length)
      correctIndex = inferFromExplanation(explanation, options);
    result.push({ prompt, options, correctIndex, explanation });
  }
  return result;
}


/** Alias kept for callers that use the English name. */
export const extractQuestions = parseQuestionsFromText;
