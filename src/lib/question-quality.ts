/**
 * GUARDIÃO DE QUALIDADE DE CONTEÚDO DAS QUESTÕES (ESTUDAJÁ)
 *
 * Detecta META-OPÇÕES e formulações vagas — alternativas que descrevem o
 * acerto/erro em vez de apresentar afirmações técnicas concretas
 * (ex.: "Apresenta a definição correta de...", "Contradiz os fundamentos...").
 *
 * Usado tanto na geração (regeneração automática) quanto na auditoria
 * pós-geração de Exercícios e Avaliações.
 */

function norm(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Padrões de meta-texto proibidos em alternativas, gabaritos e enunciados. */
export const META_OPTION_PATTERNS: Array<[RegExp, string]> = [
  [/apresenta (?:a |uma )?(?:definicao|descricao|conceituacao) (?:correta|adequada|precisa)/, "apresenta a definição correta"],
  [/(?:definicao|descricao) (?:correta|incorreta) de/, "definição correta/incorreta de"],
  [/(?:propoe|apresenta|oferece|traz) (?:uma )?(?:interpretacao|leitura|analise) (?:incorreta|equivocada|imprecisa)/, "propõe uma interpretação incorreta"],
  [/incorret[ao] (?:segundo|conforme|de acordo com)/, "incorreta segundo o material"],
  [/contradiz (?:os |as |o |a )?(?:fundamentos|literatura|conteudo|material|principios)/, "contradiz os fundamentos"],
  [/fundamentos do material/, "fundamentos do material"],
  [/(?:descreve|explica|conceitua) (?:de forma|de maneira) (?:incorreta|imprecisa|equivocada|generica|tecnicamente imprecisa)/, "descreve de forma imprecisa"],
  [/afirmacao (?:correta|incorreta) sobre/, "afirmação incorreta sobre"],
  [/confunde (?:o |os |a |as )?conceit/, "confunde o conceito"],
  [/reduz (?:o |a )?(?:tema|conceito) a uma definicao generica/, "reduz o tema a uma definição genérica"],
  [/(?:de acordo com|segundo|conforme) (?:o|a) (?:material|apostila|aula|modulo) estudad/, "referência ao material estudado"],
  [/associa .{0,30} sem fundament/, "associa sem fundamento"],
  [/considera .{0,30} de forma isolada/, "considera de forma isolada"],
  [/alternativa (?:correta|incorreta)/, "autorreferência à alternativa"],
  [/(?:todas|nenhuma) (?:as|das) (?:anteriores|alternativas anteriores)/, "todas/nenhuma das anteriores"],
];

/** Retorna os rótulos de meta-texto encontrados no trecho informado. */
export function detectMetaOptionPatterns(text: string): string[] {
  const t = norm(text);
  if (!t) return [];
  return META_OPTION_PATTERNS.filter(([re]) => re.test(t)).map(([, label]) => label);
}

export type ContentVerdict = {
  /** true quando a questão deve ser rejeitada/regenerada. */
  rejected: boolean;
  /** Índices (0-based) das alternativas com meta-texto. */
  offendingOptions: number[];
  signals: string[];
  message: string | null;
};

/**
 * Validação pós-geração: qualquer alternativa com meta-texto invalida a
 * questão, que deve ser regenerada com afirmações concretas.
 */
export function validateQuestionContent(args: {
  prompt: string;
  options?: string[] | null;
  explanation?: string | null;
  /** Blocos V/F e lacunas usam alternativas do tipo "V-F-V", sem conteúdo técnico. */
  skipOptions?: boolean;
}): ContentVerdict {
  const signals = new Set<string>();
  const offendingOptions: number[] = [];

  for (const s of detectMetaOptionPatterns(args.prompt)) signals.add(s);

  if (!args.skipOptions && Array.isArray(args.options)) {
    args.options.forEach((opt, idx) => {
      const found = detectMetaOptionPatterns(String(opt ?? ""));
      if (found.length > 0) {
        offendingOptions.push(idx);
        for (const s of found) signals.add(s);
      }
    });
  }

  const list = [...signals];
  const rejected = list.length > 0;
  return {
    rejected,
    offendingOptions,
    signals: list,
    message: rejected
      ? `Questão rejeitada pelo validador de conteúdo: alternativas ou enunciado com meta-texto genérico (${list
          .slice(0, 3)
          .join(", ")}). Regenere com afirmações técnicas concretas sobre o conteúdo da disciplina.`
      : null,
  };
}

/** true quando o texto bruto gerado pela IA contém meta-texto proibido. */
export function outputHasMetaOptions(rawText: string): boolean {
  return detectMetaOptionPatterns(rawText).length > 0;
}

/** Reforço injetado no prompt quando a primeira geração falha no validador. */
export function metaOptionRetryReinforcement(): string {
  return `ATENÇÃO — A GERAÇÃO ANTERIOR FOI REJEITADA PELO VALIDADOR DE QUALIDADE.
Foram detectadas META-OPÇÕES (alternativas que descrevem o acerto/erro em vez de afirmar conteúdo técnico).
Reescreva TODAS as alternativas como afirmações técnicas, conceituais ou práticas concretas da disciplina.
É PROIBIDO qualquer texto do tipo "apresenta a definição correta", "interpretação incorreta segundo o material",
"contradiz os fundamentos", "descreve de forma imprecisa", "alternativa correta", "todas as anteriores".`;
}
