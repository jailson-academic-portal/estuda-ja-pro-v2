export function normalizeLessonPlanTables(markdown: string): string {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isMarkdownTableRow(line)) {
      out.push(line);
      continue;
    }

    const table: string[] = [];
    while (i < lines.length && isMarkdownTableRow(lines[i])) {
      table.push(lines[i]);
      i++;
    }
    i--;

    out.push(...normalizeLessonPlanTable(table));
  }

  return out.join("\n");
}

export function normalizeLessonPlanMarkdown(markdown: string): string {
  let md = String(markdown ?? "").replace(/\r\n/g, "\n");

  md = md
    .replace(/^\s*[-*]?\s*\*\*Institui[çc][ãa]o(?:\s+de\s+Ensino)?\s*:\*\*[^\n]*\n?/gim, "")
    .replace(/^\s*Institui[çc][ãa]o(?:\s+de\s+Ensino)?\s*:[^\n]*\n?/gim, "");

  // Semestre deve aparecer como ordinal: "Semestre: 2" -> "Semestre: 2º".
  md = md.replace(/(Semestre:\**\s*)(\d+)(?!\s*[ºo°])/gi, "$1$2º");

  md = normalizeLessonPlanTables(md);

  return md
    .replace(/(^|\n|<br\s*\/?>)\s*[-*]\s+/g, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ensureLessonPlanStandardHeader(
  markdown: string,
  opts: { logoUrl?: string | null; fallbackTitle?: string | null } = {},
): string {
  let md = normalizeLessonPlanMarkdown(markdown);
  if (/\*\*PLANO DE AULA\*\*/i.test(md) || /^\s*(?:!\[[^\]]*\]\([^)]+\)\s*)?\*\*Disciplina:\*\*/im.test(md)) return md;

  const discipline =
    firstMatch(md, /^#{1,3}\s*Plano de Aula\s*[:\-–—]\s*(.+)$/im) ||
    firstMatch(md, /^\s*\*\*Plano de Aula\s*:\*\*\s*(.+)$/im) ||
    firstMatch(md, /^\s*Plano de Aula\s*[:\-–—]\s*(.+)$/im) ||
    cleanFallbackTitle(opts.fallbackTitle) ||
    "Plano de Aula";
  const professor =
    firstMatch(md, /^\s*[-*•]?\s*(?:\*\*)?Professor\(a\)\s*:(?:\*\*)?\s*(.+)$/im) ||
    "A ser definido";
  const period =
    firstMatch(md, /^\s*[-*•]?\s*(?:\*\*)?Per[íi]odo\s*:(?:\*\*)?\s*(.+)$/im) ||
    "A definir";

  md = md
    .replace(/^#{1,3}\s*Plano de Aula\s*[:\-–—].*\n?/im, "")
    .replace(/^\s*\*\*Plano de Aula\s*:\*\*.*\n?/im, "")
    .replace(/^\s*Plano de Aula\s*[:\-–—].*\n?/im, "")
    .replace(/^\s*[-*•]?\s*(?:\*\*)?Professor\(a\)\s*:(?:\*\*)?.*\n?/gim, "")
    .replace(/^\s*[-*•]?\s*(?:\*\*)?Per[íi]odo\s*:(?:\*\*)?.*\n?/gim, "")
    .replace(/^\s*---\s*\n?/, "")
    .trimStart();

  const header: string[] = [];
  if (opts.logoUrl) header.push(`![Logo](${opts.logoUrl})`, "");
  header.push(`**PLANO DE AULA**`);
  header.push(`**Disciplina:** ${discipline}`);
  header.push(`**Professor(a):** ${professor}`);
  header.push(`**Período:** ${period}`);
  header.push("", "---", "");

  return `${header.join("\n")}${md}`.trim();
}

function normalizeLessonPlanTable(lines: string[]): string[] {
  const rows = lines.map(splitMarkdownTableRow);
  const header = rows[0]?.map(normalizeHeaderCell) ?? [];
  const dataIndex = header.indexOf("data");

  return rows.map((cells) => {
    const normalizedCells = cells.map((cell) =>
      cell.replace(/(^|<br\s*\/?>)\s*[-*]\s+/g, "$1• ").trim(),
    );
    if (dataIndex >= 0 && normalizedCells.length > dataIndex) {
      normalizedCells.splice(dataIndex, 1);
    }
    return `| ${normalizedCells.join(" | ")} |`;
  });
}

function isMarkdownTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|", 1);
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function normalizeHeaderCell(cell: string): string {
  return cell.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function firstMatch(markdown: string, re: RegExp): string | null {
  const match = markdown.match(re);
  return match?.[1]?.trim() || null;
}

function cleanFallbackTitle(title?: string | null): string | null {
  if (!title) return null;
  return title
    .replace(/^Plano de Aula\s*[—-]\s*/i, "")
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\s+a\s+\d{4}-\d{2}-\d{2}\)\s*$/i, "")
    .trim() || null;
}