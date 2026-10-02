/**
 * GUARDIÃO DE NÍVEL DE DIFICULDADE (ESTUDAJÁ)
 *
 * Classifica automaticamente o nível cognitivo real de cada questão gerada
 * (Básico, Intermediário, Avançado, Superior Universitário) e compara com o
 * nível declarado pelo professor. Quando há incompatibilidade, a questão NÃO é
 * aprovada automaticamente: recebe o status "requer ajuste de nível ou
 * simplificação" e uma sugestão de enunciado compatível com o nível escolhido.
 */

import { sanitizeConceptTopic } from "@/lib/text-sanitize";

export type DeclaredLevel = "basico" | "medio" | "avancado" | "superior";
export type CognitiveLevel = 1 | 2 | 3 | 4;


export const LEVEL_NAMES: Record<CognitiveLevel, string> = {
  1: "Básico",
  2: "Intermediário",
  3: "Avançado",
  4: "Superior Universitário",
};

export const DECLARED_TO_LEVEL: Record<DeclaredLevel, CognitiveLevel> = {
  basico: 1,
  medio: 2,
  avancado: 3,
  superior: 4,
};

function norm(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Sinais de AVALIAÇÃO / TOMADA DE DECISÃO → nível superior universitário. */
const L4_SIGNALS: Array<[RegExp, string]> = [
  [/fundamentar (?:uma |a )?(?:decisao|escolha|conduta)/, "fundamentar uma decisão técnica"],
  [/criterio (?:mais |tecnicamente )?(?:adequado|apropriado|indicado)/, "critério mais adequado"],
  [/melhor fundamenta/, "melhor fundamenta uma decisão"],
  [/(?:avaliar|julgar|ponderar) (?:as )?evidencias/, "avaliar evidências"],
  [/tomada de decisao|tomar (?:uma )?decisao/, "tomada de decisão"],
  [/impacto (?:regulatorio|etico|regulatorio\/etico)/, "impacto regulatório/ético"],
  [/planejar|planejamento (?:de|do|da) (?:projeto|processo|estrategia)/, "planejamento"],
  [/aplicacoes clinicas ou regulatorias/, "conexão com aplicações clínicas/regulatórias"],
  [/justificar tecnicamente|defender (?:a )?escolha/, "justificativa técnica"],
  [/justificativa tecnica/, "justificativa técnica"],
  [/interpretacao final/, "interpretação final integradora"],
];

/** Sinais de ANÁLISE / INTEGRAÇÃO → nível avançado. */
const L3_SIGNALS: Array<[RegExp, string]> = [
  [/\banalis(?:e|ar|ando)\b/, "analisar"],
  [/integrar? (?:as )?(?:multiplas )?informacoes|integrando/, "integrar informações"],
  [/considerando os dados|com base nos dados|a partir dos dados/, "análise de dados"],
  [/mais de um (?:passo|fator|criterio)|multiplas variaveis|diversos fatores/, "múltiplas variáveis"],
  [/estudo de caso|caso clinico|no cenario descrito|na situacao descrita/, "caso prático detalhado"],
  [/diferenciar (?:produtos|processos)/, "diferenciação técnica"],
];

/** Sinais de COMPREENSÃO / APLICAÇÃO → nível intermediário. */
const L2_SIGNALS: Array<[RegExp, string]> = [
  [/\brelacion(?:e|ar|a)\b/, "relacionar"],
  [/\binterpret(?:e|ar|acao)\b/, "interpretar"],
  [/\bcompar(?:e|ar|acao)\b/, "comparar"],
  [/\bexpliq(?:ue)\b|\bexplicar\b/, "explicar em contexto"],
  [/\baplic(?:ar|ando|acao)\b|aplique/, "aplicar regra/fórmula"],
  [/considerando (?:o|a|os|as) (?:papel|funcao|uso|contexto)/, "contextualização simples"],
  [/implicacao pratica|na pratica profissional/, "implicação prática"],
];

/** Sinais de MEMORIZAÇÃO / RECONHECIMENTO → nível básico. */
const L1_SIGNALS: Array<[RegExp, string]> = [
  [/\bdefin(?:a|ir|icao)\b/, "definir"],
  [/\bidentifiq(?:ue)\b|\bidentificar\b/, "identificar"],
  [/\breconhec(?:a|er)\b/, "reconhecer"],
  [/assinale a alternativa correta/, "assinale a alternativa correta"],
  [/\bcomplete\b|\bassocie\b/, "completar/associar"],
  [/melhor descreve|qual e o conceito/, "descrição de conceito"],
];

export type LevelClassification = {
  level: CognitiveLevel;
  label: string;
  signals: string[];
};

/**
 * Identifica o tipo de tarefa cognitiva exigida pelo enunciado (e, de forma
 * complementar, pelas alternativas).
 */
export function classifyCognitiveLevel(prompt: string, options?: string[] | null): LevelClassification {
  const p = norm(prompt);
  const all = `${p} ${norm((options ?? []).join(" "))}`;
  const match = (list: Array<[RegExp, string]>, hay: string) =>
    list.filter(([re]) => re.test(hay)).map(([, label]) => label);

  const s4 = match(L4_SIGNALS, all);
  if (s4.length > 0) return { level: 4, label: LEVEL_NAMES[4], signals: s4 };

  const s3 = match(L3_SIGNALS, p);
  const longCase = p.length >= 320;
  if (s3.length > 0 || longCase) {
    return { level: 3, label: LEVEL_NAMES[3], signals: longCase ? [...s3, "enunciado longo com caso detalhado"] : s3 };
  }

  const s2 = match(L2_SIGNALS, p);
  if (s2.length > 0 || p.length >= 200) {
    return { level: 2, label: LEVEL_NAMES[2], signals: s2.length > 0 ? s2 : ["mini-cenário contextualizado"] };
  }

  const s1 = match(L1_SIGNALS, p);
  return { level: 1, label: LEVEL_NAMES[1], signals: s1.length > 0 ? s1 : ["pergunta direta de reconhecimento"] };
}

/**
 * Expressões de decisão técnica que NUNCA podem aparecer em questões de nível
 * básico. Usadas para classificar internamente a questão como
 * "nível real > básico" e propor um enunciado simples.
 */
const BASIC_FORBIDDEN_SIGNALS: Array<[RegExp, string]> = [
  [/fundamentar (?:uma |a )?(?:decisao|escolha|conduta)/, "fundamentar uma decisão técnica"],
  [/criterio (?:mais |tecnicamente )?(?:adequado|apropriado|indicado)/, "critério mais adequado"],
  [/justificativa tecnica|justificar tecnicamente/, "justificativa técnica"],
  [/interpretacao final/, "interpretação final integradora"],
  [/aplicacoes clinicas ou regulatorias/, "conexão com aplicações clínicas ou regulatórias"],
];

/** Detecta linguagem de decisão técnica incompatível com o nível básico. */
export function detectBasicLevelViolations(prompt: string): string[] {
  const p = norm(prompt);
  return BASIC_FORBIDDEN_SIGNALS.filter(([re]) => re.test(p)).map(([, label]) => label);
}

/** Artigo/flexão prováveis para o conceito central (heurística pt-BR). */
function conceptGender(concept: string): { article: string; participle: string } {
  const head = norm(concept).split(/\s+/)[0] ?? "";
  const feminine = /(cao|dade|ncia|encia|ura|eza|lei|regra|equacao|constante)$/.test(head) || /a$/.test(head);
  return feminine ? { article: "a", participle: "estudada" } : { article: "o", participle: "estudado" };
}

/**
 * Enunciado básico sugerido, mantendo o mesmo conceito central da apostila.
 * Padrões pedidos: "Sobre [CONCEITO] estudada neste módulo, assinale a
 * alternativa correta." / "Em relação à [CONCEITO] estudada neste módulo, qual
 * alternativa está de acordo com o conteúdo?"
 */
export function suggestBasicStem(concept: string | null, variant: 0 | 1 = 0): string {
  const c = concept && concept.trim() ? sanitizeConceptTopic(concept.trim()) : "o conceito estudado";
  const { article, participle } = conceptGender(c);
  if (variant === 1) {
    const prep = article === "a" ? "à" : "ao";
    return `Em relação ${prep} ${c} ${participle} neste módulo, qual alternativa está de acordo com o conteúdo?`;
  }
  return `Sobre ${article} ${c} ${participle} neste módulo, assinale a alternativa correta.`;
}


/** Enunciado alternativo compatível com o nível declarado. */
export function suggestStemForLevel(level: CognitiveLevel, concept: string | null): string {
  const c = concept && concept.trim() ? sanitizeConceptTopic(concept.trim()) : "[CONCEITO DA APOSTILA]";
  switch (level) {
    case 1:
      return suggestBasicStem(concept ?? null, 0);
    case 2:
      return `Considerando o papel de ${c} no conteúdo estudado, qual alternativa expressa corretamente seu conceito central e sua aplicação?`;
    case 3:
      return `No estudo de ${c}, considerando os dados e características apresentados no material, qual alternativa analisa corretamente a relação entre o conceito e suas consequências práticas?`;
    default:
      return `Em um contexto profissional que envolve ${c}, qual alternativa reúne o critério mais adequado para fundamentar a decisão técnica descrita?`;
  }
}


export type LevelVerdict = {
  declared: CognitiveLevel;
  detected: CognitiveLevel;
  compatible: boolean;
  /** true quando o nível real excede o declarado (bloqueia liberação automática). */
  blocked: boolean;
  message: string | null;
  suggestion: string | null;
  signals: string[];
};

/**
 * Regra de validação por nível:
 * - Básico: bloqueia qualquer sinal de nível 2+ ligado a decisão/análise.
 * - Intermediário: bloqueia carga de decisão técnica complexa (nível 3+).
 * - Avançado/Superior: nunca bloqueia; apenas sugere simplificação de linguagem.
 */
export function validateQuestionLevel(args: {
  prompt: string;
  options?: string[] | null;
  declared: DeclaredLevel;
  concept?: string | null;
}): LevelVerdict {
  const declared = DECLARED_TO_LEVEL[args.declared] ?? 2;
  const cls = classifyCognitiveLevel(args.prompt, args.options ?? null);
  let detected = cls.level;
  const basicViolations = detectBasicLevelViolations(args.prompt);
  // Comportamento cirúrgico: em prova BÁSICA, linguagem de decisão técnica
  // classifica internamente a questão como "nível real > básico".
  if (declared === 1 && basicViolations.length > 0 && detected < 3) detected = 4;

  // Avançado/Superior: sem bloqueio.
  if (declared >= 3) {
    const confusing = norm(args.prompt).length >= 460;
    return {
      declared,
      detected,
      compatible: true,
      blocked: false,
      message: confusing
        ? "Enunciado muito longo — considere simplificar a linguagem mantendo o nível de exigência."
        : null,
      suggestion: null,
      signals: cls.signals,
    };
  }

  // Básico exige nível 1; Intermediário aceita 1 e 2.
  const limit = declared === 1 ? 1 : 2;
  if (detected <= limit) {
    return { declared, detected, compatible: true, blocked: false, message: null, suggestion: null, signals: cls.signals };
  }

  const suggestion =
    declared === 1
      ? suggestBasicStem(args.concept ?? null, 0)
      : suggestStemForLevel(declared, args.concept ?? null);
  const signals = basicViolations.length > 0 ? [...new Set([...basicViolations, ...cls.signals])] : cls.signals;
  return {
    declared,
    detected,
    compatible: false,
    blocked: true,
    message:
      `Nível real (${LEVEL_NAMES[detected]}) incompatível com o nível declarado (${LEVEL_NAMES[declared]}).` +
      (signals.length > 0 ? ` Sinais detectados: ${signals.slice(0, 3).join(", ")}.` : "") +
      ` Simplifique o enunciado ou altere o nível da questão para ${LEVEL_NAMES[Math.min(4, detected) as CognitiveLevel]}.`,
    suggestion,
    signals,
  };
}

/** Regras injetadas no prompt da IA para respeitar o nível declarado. */
export function difficultyGuardRules(): string {
  return `=== RESPEITO OBRIGATÓRIO AO NÍVEL DE DIFICULDADE DECLARADO ===

Cada questão deve exigir EXATAMENTE a tarefa cognitiva do nível declarado:
- BÁSICO: definir, identificar, reconhecer, "assinale a alternativa correta", completar, associar. Enunciado curto e direto.
- INTERMEDIÁRIO: interpretar, relacionar, explicar em contexto, comparar dois conceitos, aplicar diretamente uma regra/fórmula. Mini-cenário simples.
- AVANÇADO: analisar, integrar múltiplas informações, resolver problema com mais de um passo, casos práticos com dados combinados.
- SUPERIOR UNIVERSITÁRIO: avaliar, julgar, fundamentar decisão técnica, escolher o critério mais adequado, planejar, discutir impacto regulatório/ético.

PROIBIÇÕES ESTRITAS:
- Em questões de nível BÁSICO é PROIBIDO usar expressões como "fundamentar uma decisão técnica", "critério mais adequado", "avaliar evidências", "tomar decisão", "impacto regulatório", "analisar o caso" ou conexões finais com "aplicações clínicas ou regulatórias". Use "Sobre X, assinale a alternativa correta de acordo com o material estudado."
- Em questões de nível INTERMEDIÁRIO é PROIBIDO exigir fundamentação de decisão técnica complexa ou longa análise de caso.
- Enunciados meta-avaliativos ("qual alternativa reúne o critério mais adequado para fundamentar uma decisão técnica?") só podem aparecer nos níveis AVANÇADO e SUPERIOR.
- O nível define o TIPO DE RACIOCÍNIO exigido, não apenas o vocabulário.`;
}

export const DIFFICULTY_GUARD_RULES = difficultyGuardRules();

/**
 * CALIBRAÇÃO ESTRITA DOS 4 NÍVEIS + PROIBIÇÃO DE META-OPÇÕES.
 * Bloco único compartilhado por Exercícios e Avaliações.
 */
export function difficultyCalibrationRules(): string {
  return `=== CALIBRAÇÃO ESTRITA DOS 4 NÍVEIS DE DIFICULDADE (OBRIGATÓRIO) ===

- "basico": questões conceituais e diretas. Definições, terminologias e fundamentos elementares. Distratores simples, porém factuais e plausíveis.
- "intermediario": questões de compreensão e aplicação direta. Comparações, relações de causa e efeito e identificação de padrões.
- "avancado": questões de aplicação prática e análise. Resolução de problemas, interpretação de dados e cenários contextualizados.
- "superior" / "universitario": questões de análise crítica e tomada de decisão técnica. Casos práticos detalhados, raciocínio aprofundado e rigor conceitual da área.

O nível declarado define o TIPO DE RACIOCÍNIO exigido, não apenas o vocabulário.

=== PROIBIÇÃO ABSOLUTA DE META-OPÇÕES E FORMULAÇÕES VAGAS ===

- É TERMINANTEMENTE PROIBIDO gerar alternativas que descrevam o erro ou o acerto de forma genérica. Exemplos proibidos: "Apresenta a definição correta de...", "Propõe uma interpretação incorreta segundo o material...", "Contradiz os fundamentos...", "Descreve de forma tecnicamente imprecisa...", "Afirmação incorreta sobre...", "Alternativa correta", "Todas as anteriores", "Nenhuma das anteriores".
- TODAS as alternativas (gabarito e distratores) devem conter afirmações técnicas, conceituais ou práticas CONCRETAS sobre o conteúdo real da disciplina.
- Os distratores devem ser plausíveis, baseados em equívocos conceituais reais da área, sem pegadinhas gramaticais nem obviedades infantis.

=== COERÊNCIA ENTRE GABARITO E JUSTIFICATIVA ===

- A justificativa/explicação deve citar o porquê técnico factual da alternativa correta E o erro conceitual específico de cada uma das demais.
- O índice da resposta correta deve corresponder EXATAMENTE à afirmação correta gerada (verifique antes de responder).`;
}

export const DIFFICULTY_CALIBRATION_RULES = difficultyCalibrationRules();
