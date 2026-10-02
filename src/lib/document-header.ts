export type EditableDocumentHeader = {
  institution_name?: string | null;
  course_name?: string | null;
  discipline_name?: string | null;
  teacher_name?: string | null;
  theme?: string | null;
};

const HEADER_RE = /<!--\s*estudaja-header:([\s\S]*?)\s*-->/i;

export function parseDocumentHeader(markdown?: string | null): EditableDocumentHeader | null {
  const match = String(markdown ?? "").match(HEADER_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as EditableDocumentHeader;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function stripDocumentHeaderMetadata(markdown?: string | null): string {
  return String(markdown ?? "").replace(HEADER_RE, "").trimStart();
}

export function withDocumentHeaderMetadata(
  markdown: string,
  header: EditableDocumentHeader,
): string {
  const clean = stripDocumentHeaderMetadata(markdown);
  const normalized: EditableDocumentHeader = {
    institution_name: header.institution_name?.trim() || null,
    course_name: header.course_name?.trim() || null,
    discipline_name: header.discipline_name?.trim() || null,
    teacher_name: header.teacher_name?.trim() || null,
    theme: header.theme?.trim() || null,
  };
  return `<!-- estudaja-header:${encodeURIComponent(JSON.stringify(normalized))} -->\n${clean}`.trim();
}

/**
 * Removes the VISIBLE standardized header block that the AI assistant bakes at
 * the top of dispatched documents (optional logo image + **Disciplina:** /
 * **Curso:** / **Professor(a):** / identification line, terminated by a `---`
 * horizontal rule). Used so the on-screen viewer and the fresh PDF export do
 * not duplicate the header (the metadata is re-rendered from live data).
 */
export function stripLeadingStandardHeader(markdown?: string | null): string {
  const md = stripDocumentHeaderMetadata(markdown);
  if (!/\*\*Disciplina:\*\*/.test(md.slice(0, 1000))) return md;
  const m = md.match(/^[\s\S]*?\n-{3,}[ \t]*(?:\n|$)/);
  return m ? md.slice(m[0].length).trimStart() : md;
}

/**
 * Older activity syllabuses (ementas) were generated with the generic
 * "EMENTA — ATIVIDADE EXTRA" title and "Tema da Atividade:" line baked into the
 * body. "Atividade Extra" is only the delivery channel, not the activity type,
 * so at export/view time we rewrite these to the real subtype label, e.g.
 * "EMENTA — ESTUDO DE CASO" and "Tema do Estudo de Caso:".
 */
export function normalizeActivitySyllabusLabels(
  markdown: string,
  subtypeLabel: string,
  article: "do" | "da" = "do",
): string {
  const label = subtypeLabel.trim();
  if (!label) return markdown;
  return markdown
    .replace(
      /^(#{1,6})\s*EMENTA\s*[—–-]\s*ATIVIDADE\s+EXTRA\s*$/gim,
      `$1 EMENTA — ${label.toUpperCase()}`,
    )
    .replace(
      /\*\*Tema\s+d[ao]\s+Atividade:\*\*/gi,
      `**Tema ${article} ${label}:**`,
    );
}

/**
 * Extracts the dynamic identification line ("**Label:** value") that the AI
 * bakes into the standardized header (e.g. "**Estudo de Caso:** Módulo 2: …"),
 * skipping the fixed Disciplina / Curso / Professor(a) / Instituição lines.
 * Returns null when no such line exists. Used to reproduce the teacher's exact
 * header — including the module identification — on the student's export.
 */
export function extractStandardHeaderDocLine(
  markdown?: string | null,
): { label: string; value: string } | null {
  const md = stripDocumentHeaderMetadata(markdown);
  const ruleIdx = md.search(/\n-{3,}[ \t]*(?:\n|$)/);
  const region = ruleIdx >= 0 ? md.slice(0, ruleIdx) : md.slice(0, 1200);
  const skip = /^(disciplina|curso|professor\(a\)|professor|institui[çc][ãa]o)$/i;
  const re = /\*\*([^:*\n]+):\*\*\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(region)) !== null) {
    const label = match[1].trim();
    const value = match[2].trim();
    if (label && value && !skip.test(label)) return { label, value };
  }
  return null;
}

/**
 * Converts Markdown into a compact single-line plain-text string for card
 * previews/snippets, removing symbols (#, **, >, list markers, table pipes,
 * images, links) that otherwise leak into the UI and hurt readability.
 */
export function markdownToPlainText(markdown?: string | null): string {
  return String(markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*([-*_]\s*){3,}\s*$/gm, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
