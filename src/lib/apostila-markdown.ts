/**
 * Deterministic normalization for apostila (handout) markdown.
 *
 * The AI is instructed to emit the front-matter sections (Apresentação,
 * Objetivos, Sumário) as level-2 markdown headings ("## Título"), but the model
 * is not reliable about it — it frequently drops the "## " markers and emits the
 * titles as plain text. When that happens the PDF renderer can no longer detect
 * the "## Sumário" block, so it neither gives the Sumário its own page nor
 * rebuilds it as a page-referenced table of contents.
 *
 * This helper promotes the known front-matter section titles to proper "## "
 * headings so the renderer's two-pass table-of-contents logic works
 * deterministically — for both existing stored apostilas and new ones, and
 * identically for the teacher and student versions.
 */
const FRONT_MATTER_TITLES: RegExp[] = [
  /^apresenta[çc][ãa]o$/i,
  /^objetivos(?:\s+gerais(?:\s+e\s+espec[íi]ficos)?)?$/i,
  /^sum[áa]rio$/i,
];

function cleanHeadingText(text: string): string {
  return String(text ?? "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalModuleTitle(text: string): string | null {
  const clean = cleanHeadingText(text);
  const m = clean.match(/^m[óo]dulo\s*0*(\d+)\s*(?:[:\-–—]\s*)?(.*)$/i);
  if (!m) return null;
  const num = String(Number.parseInt(m[1], 10));
  const name = (m[2] ?? "").replace(/^[:\-–—]\s*/, "").trim();
  return name ? `Módulo ${num}: ${name}` : `Módulo ${num}`;
}

function canonicalLessonTitle(text: string): string | null {
  const clean = cleanHeadingText(text);
  const m = clean.match(/\baula\s*0*(\d+)\s*(?:[:\-–—.)]\s*)?(.*)$/i);
  if (!m) return null;
  const num = String(Number.parseInt(m[1], 10));
  let theme = (m[2] ?? "")
    .replace(/^m[óo]dulo\s*0*\d+\s*(?:[:\-–—]\s*)?/i, "")
    .replace(/^aula\s*0*\d+\s*(?:[:\-–—.)]\s*)?/i, "")
    .trim();
  return theme ? `Aula ${num}: ${theme}` : `Aula ${num}`;
}

function extractModulePrefixFromCombinedTitle(text: string): string | null {
  const clean = cleanHeadingText(text);
  const aulaIdx = clean.search(/\baula\s*0*\d+/i);
  if (aulaIdx <= 0) return null;
  return canonicalModuleTitle(clean.slice(0, aulaIdx).replace(/[\s\-–—:]+$/g, ""));
}

function isReferencesTitle(text: string): boolean {
  return /^refer[êe]ncias(\s+bibliogr[áa]ficas)?(\s+expandidas)?$/i.test(cleanHeadingText(text));
}


function isSummaryTitle(text: string): boolean {
  return /^sum[áa]rio$/i.test(cleanHeadingText(text));
}

function isFrontMatterTitle(text: string): boolean {
  const clean = cleanHeadingText(text);
  return FRONT_MATTER_TITLES.some((re) => re.test(clean));
}

function looksLikeModuleOrLessonTitle(text: string): boolean {
  const clean = cleanHeadingText(text);
  return /^m[óo]dulo\s*0*\d+\b/i.test(clean) || /^aula\s*0*\d+\b/i.test(clean);
}

function rebuildSummary(lines: string[]): string[] {
  const sumIdx = lines.findIndex((line) => /^##\s+sum[áa]rio\s*$/i.test(line.trim()));
  if (sumIdx < 0) return lines;

  let endSum = lines.length;
  for (let i = sumIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      endSum = i;
      break;
    }
  }

  const entries: string[] = [];
  const seen = new Set<string>();
  for (let i = endSum; i < lines.length; i++) {
    const h = lines[i].trim().match(/^(#{2,3})\s+(.+)$/);
    if (!h) continue;
    const text = cleanHeadingText(h[2]);
    const isModule = h[1].length === 2 && /^m[óo]dulo\b/i.test(text);
    const isLesson = h[1].length === 3 && /^aula\b/i.test(text);
    const isRefs = h[1].length === 2 && isReferencesTitle(text);
    if (!isModule && !isLesson && !isRefs) continue;
    const key = `${h[1].length}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(isLesson ? `- ${text}` : text);
  }

  return compactBlankLines([
    ...lines.slice(0, sumIdx + 1),
    "",
    ...entries,
    "",
    ...lines.slice(endSum),
  ]);
}

function compactBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !out[out.length - 1]?.trim()) continue;
    out.push(line);
  }
  return out;
}

export function normalizeApostilaMarkdown(markdown: string): string {
  const source = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let currentModule = "";
  let insideLesson = false;
  let seenSummary = false;

  for (let i = 0; i < source.length; i++) {
    const rawLine = source[i];
    const heading = rawLine.match(/^(#{1,6})\s+(.+?)\s*$/);
    const bare = cleanHeadingText(rawLine);

    if (heading || isFrontMatterTitle(bare) || isReferencesTitle(bare) || looksLikeModuleOrLessonTitle(bare)) {
      const level = heading ? heading[1].length : 2;
      const text = heading ? cleanHeadingText(heading[2]) : bare;

      if (isSummaryTitle(text)) {
        // Keep a single Sumário. Its body is rebuilt below from the normalized
        // module/lesson headings, and the PDF renderer replaces it with real
        // page numbers in a second pass.
        if (!seenSummary) {
          normalized.push("## Sumário");
          seenSummary = true;
        }
        // Descarta as linhas do próprio sumário (entradas de lista, linhas
        // pontilhadas ou "... Pág X") E os blocos redundantes que aparecem
        // entre o fim do Sumário e o primeiro título de Módulo/Aula/
        // Referências: repetições de ementa/objetivos gerais, cronograma geral
        // dos módulos, caixas de metadados, resumos preliminares soltos e
        // avisos pedagógicos duplicados. O descarte só para quando encontra o
        // primeiro Módulo, Aula ou Referências — então o corpo real da
        // apostila nunca é apagado.
        // Salvaguarda: só descartamos se existir, adiante, um título de
        // Módulo/Aula/Referências. Caso a apostila use outra nomenclatura
        // (Capítulo, Introdução, etc.), nada é removido — o corpo do documento
        // nunca é apagado.
        let probe = i;
        let foundStop = false;
        while (probe + 1 < source.length) {
          const next = source[probe + 1].trim();
          if (!next) { probe++; continue; }
          const nextBare = cleanHeadingText(next);
          if (looksLikeModuleOrLessonTitle(nextBare) || isReferencesTitle(nextBare)) {
            foundStop = true;
            break;
          }
          probe++;
        }
        if (foundStop) i = probe;

        continue;
      }

      const combinedModule = extractModulePrefixFromCombinedTitle(text);
      const lessonTitle = canonicalLessonTitle(text);
      if (combinedModule && lessonTitle) {
        if (combinedModule !== currentModule) {
          normalized.push(`## ${combinedModule}`);
          currentModule = combinedModule;
        }
        normalized.push(`### ${lessonTitle}`);
        insideLesson = true;
        continue;
      }

      const moduleTitle = canonicalModuleTitle(text);
      if (moduleTitle && !lessonTitle) {
        normalized.push(`## ${moduleTitle}`);
        currentModule = moduleTitle;
        insideLesson = false;
        continue;
      }

      if (lessonTitle) {
        normalized.push(`### ${lessonTitle}`);
        insideLesson = true;
        continue;
      }

      if (isReferencesTitle(text)) {
        normalized.push("## Referências Bibliográficas Expandidas");
        insideLesson = false;
        continue;
      }

      if (isFrontMatterTitle(text)) {
        normalized.push(`## ${text}`);
        insideLesson = false;
        continue;
      }

      if (/^objetivos\s+de\s+aprendizagem:?$/i.test(text)) {
        normalized.push("#### Objetivos de Aprendizagem:");
        continue;
      }

      if (insideLesson && level <= 3) {
        normalized.push(`#### ${text}`);
        continue;
      }
    }

    if (/^\s*objetivos\s+de\s+aprendizagem:?\s*$/i.test(rawLine.trim())) {
      normalized.push("#### Objetivos de Aprendizagem:");
      continue;
    }

    normalized.push(rawLine);
  }

  return compactBlankLines(rebuildSummary(normalized)).join("\n").trim() + "\n";
}
