/**
 * Deterministic download-filename derivation, shared by the teacher export
 * (`exportGeneration*`) and the student download (`exportMaterialPDF`) so both
 * receive the same, cleaned-up filename.
 *
 * Rules requested by the product:
 * - Plano de Aula: drop the semester date range suffix
 *   "(YYYY-MM-DD a YYYY-MM-DD)".
 * - Apostila: use the module name instead of the discipline name,
 *   e.g. "Apostila - Módulo 1: Tema".
 */
export function buildDocumentFilename(title: string, content?: string | null): string {
  const cleanTitle = String(title ?? "").trim();
  const md = String(content ?? "");

  const isApostila = /^Apostila\b/i.test(cleanTitle) || /\*\*Apostila:\*\*/i.test(md);
  if (isApostila) {
    // Prefer the first "## Módulo ..." body heading — it is exactly the
    // "Módulo N: Tema" label the user wants in the filename.
    const modHeading = md.match(/^\s*##\s+(M[óo]dulo\s+[^\n]+?)\s*$/im)?.[1]?.trim();
    if (modHeading) return `Apostila - ${modHeading.replace(/\*+/g, "").trim()}`;
    // Fallback to the dynamic header line "**Apostila:** <value>".
    const headerVal = md.match(/\*\*Apostila:\*\*\s*([^\n]+)/i)?.[1]?.replace(/\*+/g, "").trim();
    if (headerVal) return `Apostila - ${headerVal}`;
    return "Apostila";
  }

  const isLessonPlan =
    /^Plano de Aula/i.test(cleanTitle) || /\*\*PLANO DE AULA\*\*/i.test(md);
  if (isLessonPlan) {
    return (
      cleanTitle.replace(/\s*\(\d{4}-\d{2}-\d{2}\s+a\s+\d{4}-\d{2}-\d{2}\)\s*$/i, "").trim() ||
      "Plano de Aula"
    );
  }

  return cleanTitle;
}
