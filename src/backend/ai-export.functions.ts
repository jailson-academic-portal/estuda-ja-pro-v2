import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { normalizeAIContent } from "@/lib/ai-content";
import { ensureLessonPlanStandardHeader } from "@/lib/lesson-plan-markdown";
import { normalizeApostilaMarkdown } from "@/lib/apostila-markdown";
import { buildDocumentFilename } from "@/lib/document-filename";
import { resolveSlideDesign, type SlideTemplateKey } from "@/lib/slide-design";

type AnyObj = Record<string, unknown>;

function safeFileName(name: string): string {
  return String(name ?? "")
    .replace(/[^\p{L}\p{N}\s_.-]/gu, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Normalizes the professor's closing signature: removes any leading dash /
 * em-dash and guarantees a "PROF." prefix (e.g. "— Jaílson Resende" →
 * "PROF. JAÍLSON RESENDE").
 */
function formatProfessorSignature(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[\s—–-]+/, "")
    .trim();
  if (!cleaned) return "";
  return /^prof\.?\s/i.test(cleaned) ? cleaned : `PROF. ${cleaned}`;
}

/**
 * Ensures slide bullets keep a bold highlight on the leading label. Teachers
 * rely on the bold "Rótulo:" prefix (e.g. "**Neurociência:** ...") for
 * readability, but the AI sometimes emits plain "Neurociência: ..." bullets.
 * When a bullet has no markdown emphasis yet and starts with a short label
 * followed by a colon, we bold that label so exports match the intended look.
 */
function emphasizeBulletLabel(item: string): string {
  const text = String(item ?? "");
  if (/\*\*|__|(^|[^*])\*[^*]|(^|[^_])_[^_]/.test(text)) return text; // already has emphasis
  const m = text.match(/^\s*([^:*_]{2,45}):\s+(\S.*)$/);
  if (!m) return text;
  const label = m[1].trim();
  // Keep it a short label (few words), not a full sentence with a colon.
  if (label.split(/\s+/).length > 4) return text;
  return `**${label}:** ${m[2].trim()}`;
}

async function loadGeneration(id: string, userId: string): Promise<{ tool: string; title: string; result: unknown; prompt: unknown }> {
  const { data, error } = await (supabaseAdmin.from("ai_generations" as never) as unknown as {
    select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; user_id: string; tool: string; title: string; result: unknown; prompt: unknown } | null; error: { message: string } | null }> } };
  }).select("id,user_id,tool,title,result,prompt").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Não encontrado");
  return { tool: data.tool, title: data.title, result: data.result, prompt: data.prompt };
}

/** Fetches an image URL and returns a pptxgenjs-compatible data URI, or null. */
async function fetchImageDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || typeof url !== "string") return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    return `image/${ct.includes("jpeg") ? "jpeg" : ct.includes("png") ? "png" : "png"};base64,${bufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

/* ----------------------------- PDF rendering ------------------------------ */

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// pdf-lib's standard fonts (Helvetica) only support WinAnsi (cp1252) encoding,
// so characters like the Greek "µ" (U+03BC), Greek letters, or exotic unicode
// symbols throw "WinAnsi cannot encode" at draw time. This maps the most common
// offenders to safe equivalents and transliterates/strips anything else so the
// PDF always renders.
const WINANSI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u03bc/g, "\u00b5"], // Greek small mu -> micro sign
  [/[\u2018\u2019\u201a\u201b]/g, "'"], // curly single quotes
  [/[\u201c\u201d\u201e\u201f]/g, '"'], // curly double quotes
  [/[\u2013\u2014\u2015]/g, "-"], // en/em dashes
  [/\u2026/g, "..."], // ellipsis
  [/[\u00a0\u2007\u202f]/g, " "], // non-breaking spaces
  [/[\u2022\u2023\u25cf\u25aa\u2043]/g, "\u2022"], // bullets -> WinAnsi bullet
  [/\u2212/g, "-"], // minus sign
  [/[\u00d7]/g, "x"], // multiplication sign (kept as ascii for safety)
  [/\u2192/g, "->"], // arrow
];

const GREEK_TRANSLITERATION: Record<string, string> = {
  "\u03b1": "alfa", "\u03b2": "beta", "\u03b3": "gama", "\u03b4": "delta",
  "\u03b5": "epsilon", "\u03b8": "theta", "\u03bb": "lambda", "\u03c0": "pi",
  "\u03c1": "rho", "\u03c3": "sigma", "\u03c4": "tau", "\u03c6": "phi",
  "\u03c9": "omega", "\u0394": "Delta", "\u03a9": "Omega", "\u03a3": "Soma",
};

function sanitizeWinAnsi(input: string): string {
  let s = String(input ?? "");
  for (const [re, rep] of WINANSI_REPLACEMENTS) s = s.replace(re, rep);
  // Replace any remaining char that WinAnsi cannot encode.
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x017f && code !== 0x81 && code !== 0x8d && code !== 0x8f && code !== 0x90 && code !== 0x9d) {
      // Latin-1 / Latin Extended-A range largely supported; decompose accents
      // outside cp1252 to base ASCII to stay safe.
      if (code <= 0xff) { out += ch; continue; }
      out += ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      continue;
    }
    if (GREEK_TRANSLITERATION[ch]) { out += GREEK_TRANSLITERATION[ch]; continue; }
    const decomposed = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (decomposed !== ch && /^[\x20-\xff]*$/.test(decomposed)) { out += decomposed; continue; }
    // Unknown symbol — drop it rather than crash the export.
    out += "";
  }
  return out;
}

async function renderToPDF(
  title: string,
  sections: Array<{ heading?: string; lines: string[] }>,
  opts: {
    landscape?: boolean;
    headerBlock?: boolean;
    pageNumbers?: boolean;
    buildTOC?: boolean;
    tocPageMap?: Map<string, number>;
    collectHeadingPages?: Map<string, number>;
    apostilaPageBreaks?: boolean;
    genId?: string;
  } = {},
): Promise<Uint8Array> {

  const pdf = await PDFDocument.create();
  pdf.setTitle(title || "Documento Acadêmico");
  pdf.setAuthor("Plataforma EstudaJá");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);

  // Sanitize all incoming text up-front so no draw/measure call hits an
  // unencodable character.
  title = sanitizeWinAnsi(title);
  sections = sections.map((s) => ({
    heading: s.heading != null ? sanitizeWinAnsi(s.heading) : s.heading,
    lines: s.lines.map((l) => sanitizeWinAnsi(l)),
  }));
  const CM = 28.3465; // 1cm em pontos PDF
  const margin = 1.5 * CM; // margens de 1,5cm
  const pageWidth = opts.landscape ? 842 : 595;
  const pageHeight = opts.landscape ? 595 : 842;
  const maxWidth = pageWidth - margin * 2;


  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  // 1-based number of the page currently being drawn (used to map headings to
  // their page for the table of contents and to print footer page numbers).
  let pageNo = 1;

  // Embeds a remote image (logo) and returns a pdf-lib image or null.
  const embedImageFromUrl = async (url: string | null) => {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return await pdf.embedPng(buf);
      if (ct.includes("jpeg") || ct.includes("jpg") || /\.jpe?g$/i.test(url)) return await pdf.embedJpg(buf);
      try { return await pdf.embedPng(buf); } catch { /* ignore */ }
      try { return await pdf.embedJpg(buf); } catch { /* ignore */ }
      return null;
    } catch {
      return null;
    }
  };


  const wrap = (text: string, size: number, f = font, width = maxWidth): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > width) {
        if (cur) lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    pageNo += 1;
  };

  const drawLine = (text: string, size: number, f = font, color = rgb(0.1, 0.1, 0.15)) => {
    if (y < margin + size + 4) newPage();
    page.drawText(text, { x: margin, y: y - size, size, font: f, color });
    y -= size + 4;
  };

  const getBrandingLogo = async () => {
    try {
      const { resolveBrandingLogoUrl } = await import("./branding.server");
      // Use standard logoUrl if provided directly
      if (opts.genId) {
        const { data: genData } = await (supabaseAdmin.from("ai_generations" as never) as unknown as {
          select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { discipline_id: string | null; user_id: string } | null }> } };
        }).select("discipline_id, user_id").eq("id", opts.genId).maybeSingle();

        if (genData?.user_id) {
          const logoUrl = await resolveBrandingLogoUrl(genData.user_id);
          if (logoUrl) return await embedImageFromUrl(logoUrl);
        }
      }
    } catch { /* ignore */ }
    return null;
  };


  const brandingLogo = await getBrandingLogo();



  // Splits a line on **...** markers into bold/regular runs.
  // Splits inline markdown into styled runs honoring ***bold+italic***,
  // **bold**, *italic* and _italic_ so emphasis markers never render literally.
  const pickFont = (bold: boolean, italic: boolean) =>
    bold && italic ? fontBoldItalic : bold ? fontBold : italic ? fontItalic : font;
  const splitBoldRuns = (
    text: string,
    inheritBold = false,
    inheritItalic = false,
  ): Array<{ text: string; bold: boolean; italic: boolean }> => {
    const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
    const re = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last)
        runs.push({ text: text.slice(last, m.index), bold: inheritBold, italic: inheritItalic });
      // Recurse into the captured content so nested emphasis (e.g. italics
      // inside a **bold** run) is parsed instead of leaving literal markers.
      if (m[1] !== undefined) runs.push(...splitBoldRuns(m[1], true, true));
      else if (m[2] !== undefined) runs.push(...splitBoldRuns(m[2], true, inheritItalic));
      else if (m[3] !== undefined) runs.push(...splitBoldRuns(m[3], inheritBold, true));
      else if (m[4] !== undefined) runs.push(...splitBoldRuns(m[4], inheritBold, true));
      last = m.index + m[0].length;
    }
    if (last < text.length)
      runs.push({ text: text.slice(last), bold: inheritBold, italic: inheritItalic });
    return runs.length ? runs : [{ text, bold: inheritBold, italic: inheritItalic }];
  };

  // Draws a single line of text honoring bold/italic runs, wrapping by words.
  const drawRichLine = (
    text: string,
    size: number,
    color = rgb(0.1, 0.1, 0.15),
    lineOpts: { italic?: boolean; indentX?: number; maxW?: number } = {},
  ) => {
    const runs = splitBoldRuns(text, false, lineOpts.italic ?? false);
    const lineMaxW = lineOpts.maxW ?? maxWidth;
    // Remove quaisquer marcadores de ênfase remanescentes (negrito/itálico
    // desbalanceado, ex.: "**aumentam a* frequência *de abertura**") para que
    // asteriscos nunca apareçam literalmente no PDF.
    for (const r of runs) r.text = r.text.replace(/\*+/g, "");
    const startX = margin + (lineOpts.indentX ?? 0);
    // Tokenize each run into words+space tokens preserving style flags.
    type Tok = { text: string; bold: boolean; italic: boolean; w: number };
    const tokens: Tok[] = [];
    for (const r of runs) {
      const parts = r.text.split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        const f = pickFont(r.bold, r.italic);
        tokens.push({ text: p, bold: r.bold, italic: r.italic, w: f.widthOfTextAtSize(p, size) });
      }
    }
    let lineToks: Tok[] = [];
    let lineW = 0;
    const flush = () => {
      if (!lineToks.length) return;
      if (y < margin + size + 4) newPage();
      let x = startX;
      for (const t of lineToks) {
        page.drawText(t.text, { x, y: y - size, size, font: pickFont(t.bold, t.italic), color });
        x += t.w;
      }
      y -= size + 4;
      lineToks = [];
      lineW = 0;
    };
    for (const t of tokens) {
      if (lineW + t.w > lineMaxW - (lineOpts.indentX ?? 0) && lineToks.length) {
        flush();
        if (/^\s+$/.test(t.text)) continue;
      }
      lineToks.push(t);
      lineW += t.w;
    }
    flush();
  };

  // Pré-calcula o layout (larguras, quebras e alturas) de uma tabela markdown.
  const layoutTable = (rows: string[][]) => {
    const cols = rows[0].length;
    const fontSize = 9;
    const cellPadX = 4;
    const cellPadY = 4;
    const lineHeight = fontSize + 2;
    // Narrow widths for "Aula" and "Data" columns (justified) so other
    // columns get more breathing room. Detected by header text.
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const narrowMap = header.map((h) => h === "aula" || h === "data");
    const narrowCount = narrowMap.filter(Boolean).length;
    const narrowW = 52; // pts
    const remaining = maxWidth - narrowW * narrowCount;
    const wideW = remaining / Math.max(1, cols - narrowCount);
    const colWidths = narrowMap.map((n) => (n ? narrowW : wideW));
    const colXOffsets: number[] = [];
    {
      let acc = 0;
      for (const w of colWidths) { colXOffsets.push(acc); acc += w; }
    }

    // Pre-wrap every cell
    const wrappedRows = rows.map((row, ri) =>
      row.map((cell, ci) => {
        const txt = cell.replace(/<br\s*\/?>/gi, "\n");
        const segs = txt
          .split("\n")
          .map((s) => s.replace(/^\s*[-*]\s+/, "• "));
        const f = ri === 0 ? fontBold : font;
        const innerW = colWidths[ci] - cellPadX * 2;
        return segs.flatMap((seg) => wrap(seg, fontSize, f, innerW));
      }),
    );
    const rowHeights = wrappedRows.map(
      (r) => Math.max(1, ...r.map((c) => c.length)) * lineHeight + cellPadY * 2,
    );
    const totalH = rowHeights.reduce((a, b) => a + b, 0);
    return { cols, fontSize, cellPadX, cellPadY, lineHeight, colWidths, colXOffsets, wrappedRows, rowHeights, totalH };
  };

  const measureTableHeight = (rows: string[][]) => (rows.length ? layoutTable(rows).totalH : 0);

  // Renders a markdown-style table as a proper bordered grid.
  const drawTable = (rows: string[][]) => {
    if (rows.length === 0) return;
    const { cols, fontSize, cellPadX, cellPadY, lineHeight, colWidths, colXOffsets, wrappedRows, rowHeights } =
      layoutTable(rows);

    // break-inside: avoid — quando a tabela inteira couber em uma página nova,
    // começa a página antes para não cortar o módulo pela metade.
    const totalTableH = rowHeights.reduce((a, b) => a + b, 0);
    const usableH = pageHeight - margin * 2;
    if (y - totalTableH < margin && totalTableH <= usableH) newPage();

    for (let ri = 0; ri < wrappedRows.length; ri++) {

      const rowH = rowHeights[ri];
      if (y - rowH < margin) {
        newPage();
        // Repeat header row on new page
        if (ri > 0) {
          const headerH = rowHeights[0];
          drawTableRow(0, headerH);
        }
      }
      drawTableRow(ri, rowH);
    }

    function drawTableRow(ri: number, rowH: number) {
      const cells = wrappedRows[ri];
      const top = y;
      for (let ci = 0; ci < cols; ci++) {
        const x = margin + colXOffsets[ci];
        const colW = colWidths[ci];
        // Border
        page.drawRectangle({
          x, y: top - rowH, width: colW, height: rowH,
          borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.5,
          color: ri === 0 ? rgb(0.93, 0.95, 0.98) : rgb(1, 1, 1),
        });
        const lines = cells[ci] ?? [];
        const f = ri === 0 ? fontBold : font;
        for (let li = 0; li < lines.length; li++) {
          page.drawText(lines[li], {
            x: x + cellPadX,
            y: top - cellPadY - fontSize - li * lineHeight,
            size: fontSize, font: f, color: rgb(0.1, 0.1, 0.15),
          });
        }
      }
      y -= rowH;
    }
  };

  const ensureSpace = (h: number) => {
    if (y - h < margin) newPage();
  };


  // Title (suppressed when caller passes empty string — e.g. lesson plan
  // whose markdown already has its own "## Plano de Aula" heading).
  if (title && title.trim()) {
    for (const l of wrap(title, 18, fontBold)) drawLine(l, 18, fontBold, rgb(0.1, 0.3, 0.6));
    y -= 8;
  }

  // Standardized document header: a leading "![Logo](url)" image followed by
  // bold metadata lines up to a "---" divider is rendered as logo-left /
  // info-right, then stripped from the regular line flow.
  if (sections.length && opts.headerBlock !== false) {
    const first = sections[0];
    const imgMatch = first.lines[0]?.match(/^!\[[^\]]*\]\(([^)]+)\)\s*$/);
    if (imgMatch || /^\*\*[^*]+\*\*/.test(first.lines[0] ?? "")) {
      const headerLines: string[] = [];
      let consumed = 0;
      let li = imgMatch ? 1 : 0;
      while (li < first.lines.length) {
        const l = first.lines[li].trim();
        if (l === "---") { consumed = li + 1; break; }
        if (l) headerLines.push(l);
        li++;
        consumed = li;
      }
      const img = imgMatch ? await embedImageFromUrl(imgMatch[1]) : null;
      const logoToDraw = brandingLogo || img;
      
      const headerTop = y;
      const logoW = 3.5 * CM;
      const logoH = 1.7 * CM;
      const logoGap = 16;
      const logoBottomY = headerTop - logoH;
      
      if (logoToDraw) {
        // Obter dimensões reais da imagem para manter proporção
        const { width: iw, height: ih } = logoToDraw.scale(1);
        const ratio = iw / ih;
        let dw = logoW;
        let dh = dw / ratio;
        if (dh > logoH) {
          dh = logoH;
          dw = dh * ratio;
        }
        
        page.drawImage(logoToDraw, {
          x: margin,
          y: headerTop - dh, // Alinhado ao topo
          width: dw,
          height: dh,
        });
      }

      const textX = logoToDraw ? margin + logoW + logoGap : margin;
      const headerTextWidth = pageWidth - margin - textX;
      const lineGap = 15;
      let ty = headerTop - 2;

      for (const hl of headerLines) {
        const runs = splitBoldRuns(hl);
        // Word-level tokens so long identification lines wrap instead of
        // running off the right edge of the page.
        const tokens: { text: string; bold: boolean; italic: boolean }[] = [];
        for (const r of runs) {
          const parts = r.text.split(/(\s+)/).filter((p) => p.length > 0);
          for (const p of parts) tokens.push({ text: p, bold: r.bold, italic: r.italic });
        }
        let x = textX;
        for (const t of tokens) {
          const f = pickFont(t.bold, t.italic);
          const w = f.widthOfTextAtSize(t.text, 12);
          const isSpace = /^\s+$/.test(t.text);
          if (!isSpace && x > textX && x + w > textX + headerTextWidth) {
            ty -= lineGap;
            x = textX;
          }
          if (isSpace && x === textX) continue; // no leading space after wrap
          page.drawText(t.text, { x, y: ty - 12, size: 12, font: f, color: rgb(0.1, 0.1, 0.15) });
          x += w;
        }
        ty -= lineGap;
      }
      y = Math.min(ty, logoToDraw ? headerTop - logoH : ty) - 8;
      // Divider
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.75) });
      y -= 12;

      first.lines = first.lines.slice(consumed);

      // Remove um segundo bloco de identificação repetido (capa gerada pela IA)
      // logo no início do corpo, mantendo apenas o cabeçalho único do topo.
      const REPEATED_META =
        /^\**\s*(disciplina|curso|professor\(a\)|professor|professora|institui[çc][ãa]o|carga\s+hor[áa]ria|per[íi]odo|semestre|turma|data|documento|material\s+did[áa]tico|apostila)\s*\**\s*:/i;
      let k = 0;
      let removedMeta = false;
      while (k < first.lines.length) {
        const l = first.lines[k].trim();
        if (!l || l === "---") { k++; continue; }
        if (REPEATED_META.test(l)) { k++; removedMeta = true; continue; }
        break;
      }
      if (removedMeta) first.lines = first.lines.slice(k);

    }
  }

  // ---- Table of contents (apostila) -------------------------------------
  // Rebuilds the "## Sumário" block as a detailed, page-referenced index of
  // every module (##) and lesson (###) found in the body. Entries are emitted
  // as sentinel marker lines ("@@TOC@@<level>@@<text>") so the main render loop
  // can draw them with dotted leaders + the page number resolved from a
  // previous pass (opts.tocPageMap).
  const TOC_MARKER = "@@TOC@@";
  if (opts.buildTOC && sections.length === 1) {
    const src = sections[0].lines;
    const sumIdx = src.findIndex((l) => /^##\s+sum[áa]rio\s*$/i.test(l.trim()));
    // End of the existing sumário block = next level-2 heading after it.
    let endSum = src.length;
    if (sumIdx >= 0) {
      for (let j = sumIdx + 1; j < src.length; j++) {
        if (/^##\s+/.test(src[j].trim())) { endSum = j; break; }
      }
    }
    const scanStart = sumIdx >= 0 ? endSum : 0;
    const entries: Array<{ level: number; text: string }> = [];
    for (let j = scanStart; j < src.length; j++) {
      // Only modules (##) and lessons (###) belong in the apostila table of
      // contents — the internal "#### Subtítulo" sections are omitted so the
      // Sumário stays a clean module/lesson index with page numbers.
      const m = src[j].trim().match(/^(#{2,3})\s+(.*)$/);
      if (m) {
        const text = m[2].replace(/\*\*/g, "").trim();
        const level = m[1].length;
        const isModule = level === 2 && /^m[óo]dulo\b/i.test(text);
        const isLesson = level === 3 && /^aula\b/i.test(text);
        const isReferences = level === 2 && /^refer[êe]ncias\s+bibliogr[áa]ficas(?:\s+expandidas)?$/i.test(text);
        if (text && (isModule || isLesson || isReferences)) {
          const key = `${level}|${text.toLowerCase()}`;
          if (!entries.some((entry) => `${entry.level}|${entry.text.toLowerCase()}` === key)) {
            entries.push({ level, text });
          }
        }
      }
    }
    if (sumIdx >= 0 && entries.length > 0) {
      // "Referências Bibliográficas Expandidas" é sempre a última linha do
      // Sumário — evita entradas órfãs/repetidas depois dela.
      const isRefEntry = (e: { level: number; text: string }) =>
        e.level === 2 && /^refer[êe]ncias\s+bibliogr[áa]ficas/i.test(e.text);
      const ordered = [...entries.filter((e) => !isRefEntry(e)), ...entries.filter(isRefEntry).slice(0, 1)];
      const markerLines = ordered.map((e) => `${TOC_MARKER}${e.level}@@${e.text}`);
      sections[0].lines = [
        ...src.slice(0, sumIdx + 1),
        ...markerLines,
        ...src.slice(endSum),
      ];
    }
  }

  // Draws a single table-of-contents entry: indented label on the left, the
  // page number on the right, joined by dotted leaders. Temas longos quebram em
  // múltiplas linhas, com os pontinhos e o número apenas na última linha.
  const drawTocEntry = (level: number, text: string, pageNum?: number) => {
    const size = 11;
    const f = level === 2 ? fontBold : font;
    const indent = Math.max(0, level - 2) * 16;
    const x = margin + indent;
    const numStr = pageNum ? String(pageNum) : "";
    const numW = numStr ? font.widthOfTextAtSize(numStr, size) : 0;
    const rightX = pageWidth - margin - numW;
    const maxLabelW = rightX - x - 14;

    // Quebra o tema em linhas que caibam na largura disponível.
    const words = String(text).split(/\s+/).filter(Boolean);
    const rows: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && f.widthOfTextAtSize(next, size) > maxLabelW) {
        rows.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) rows.push(cur);
    if (rows.length === 0) return;

    for (let r = 0; r < rows.length; r++) {
      if (y < margin + size + 6) newPage();
      const isLast = r === rows.length - 1;
      const rowX = r === 0 ? x : x + 12;
      page.drawText(rows[r], { x: rowX, y: y - size, size, font: f, color: rgb(0.12, 0.12, 0.2) });
      if (isLast && numStr) {
        const labelW = f.widthOfTextAtSize(rows[r], size);
        const dotsStart = rowX + labelW + 4;
        const dotsEnd = rightX - 4;
        const dotW = font.widthOfTextAtSize(".", size);
        const dotCount = Math.max(0, Math.floor((dotsEnd - dotsStart) / dotW));
        if (dotCount > 0) {
          page.drawText(".".repeat(dotCount), { x: dotsStart, y: y - size, size, font, color: rgb(0.6, 0.6, 0.65) });
        }
        page.drawText(numStr, { x: rightX, y: y - size, size, font, color: rgb(0.12, 0.12, 0.2) });
      }
      y -= size + (isLast ? 6 : 2);
    }
  };


  // Headings that should always start on a fresh page (lesson plan sections).
  // "Estrutura do Curso" permanece na primeira página, logo após as
  // Informações Gerais; apenas estas seções iniciam em páginas novas.
  const PAGE_BREAK_HEADINGS = /^(avalia[çc][õo]es e trabalhos|refer[êe]ncias bibliogr[áa]ficas)$/i;

  // Categorias do "Banco de Temas Sugeridos" renderizadas como caixas.
  const THEME_BOX_HEADINGS =
    /^(estudos? de caso\b.*|casos? simulcl[íi]nica.*|casos? simulsa[úu]de.*|trabalho acad[êe]mico( semestral)?|atividades complementares.*|atividades extras.*|din[âa]mica das atividades pr[áa]ticas.*)$/i;

  const THEME_BOX_STYLES: Array<{ test: RegExp; accent: ReturnType<typeof rgb>; fill: ReturnType<typeof rgb> }> = [
    { test: /^estudos? de caso/i, accent: rgb(0.05, 0.55, 0.55), fill: rgb(0.93, 0.98, 0.98) },
    { test: /simul/i, accent: rgb(0.12, 0.45, 0.75), fill: rgb(0.93, 0.96, 0.99) },
    { test: /^trabalho/i, accent: rgb(0.62, 0.38, 0.1), fill: rgb(0.99, 0.96, 0.91) },
    { test: /^atividades/i, accent: rgb(0.38, 0.3, 0.65), fill: rgb(0.96, 0.95, 0.99) },
    // Módulo prático (sem aulas teóricas): dinâmica das atividades em caixa única.
    { test: /^din[âa]mica/i, accent: rgb(0.1, 0.5, 0.35), fill: rgb(0.93, 0.98, 0.95) },
  ];

  /**
   * Caixa visual de uma categoria do Banco de Temas: faixa lateral colorida,
   * fundo suave, título em destaque e itens (bullets/linhas de apoio) dentro.
   * A caixa inteira é mantida na mesma página quando cabe; caso contrário,
   * continua na página seguinte sem cortar linhas ao meio.
   */
  const drawThemeBox = (title: string, rawLines: string[]) => {
    const style = THEME_BOX_STYLES.find((s) => s.test.test(title)) ?? THEME_BOX_STYLES[0];
    const padX = 12;
    const padY = 10;
    const accentW = 4;
    const titleSize = 11;
    const bodySize = 10;
    const innerX = margin + accentW + padX;
    const innerW = maxWidth - accentW - padX * 2;

    type Line = { text: string; size: number; bold: boolean; italic: boolean; indent: number; gapAfter: number };
    const items: Line[] = [];
    for (const raw of rawLines) {
      const t = raw.replace(/\s+$/, "");
      if (!t.trim()) continue;
      const bullet = t.match(/^\s*[-*+•]\s+(.*)$/);
      if (bullet) {
        items.push({ text: `• ${bullet[1]}`, size: bodySize, bold: false, italic: false, indent: 0, gapAfter: 2 });
      } else {
        // Linha de apoio (Objetivos/Cenário/descrição) — recuada, itálico.
        items.push({ text: t.trim(), size: bodySize - 1, bold: false, italic: true, indent: 12, gapAfter: 2 });
      }
    }

    // Medição: quebra cada item na largura interna para estimar altura.
    const measure = (it: Line) => {
      const plain = it.text.replace(/\*\*/g, "");
      const f = it.italic ? fontItalic : font;
      const n = wrap(plain, it.size, f, innerW - it.indent).length;
      return n * (it.size + 4) + it.gapAfter;
    };
    const titleH = wrap(title, titleSize, fontBold, innerW).length * (titleSize + 4) + 6;
    const bodyH = items.reduce((acc, it) => acc + measure(it), 0);
    const totalH = padY * 2 + titleH + bodyH;
    const usableH = pageHeight - margin * 2;
    if (y - totalH < margin && totalH <= usableH) newPage();
    // Garante ao menos o título + primeiro item na mesma página.
    if (y - (padY + titleH + (items[0] ? measure(items[0]) : 0)) < margin) newPage();

    // Desenha a caixa em segmentos (um por página, se necessário).
    let segTop = y;
    const startSegment = () => {
      segTop = y;
    };
    const closeSegment = (bottom: number) => {
      const h = segTop - bottom;
      if (h <= 0) return;
      page.drawRectangle({
        x: margin, y: bottom, width: maxWidth, height: h,
        color: style.fill, borderColor: rgb(0.82, 0.85, 0.88), borderWidth: 0.6,
      });
      page.drawRectangle({ x: margin, y: bottom, width: accentW, height: h, color: style.accent });
    };

    // Estratégia: primeiro calcula posições, desenhando fundo antes do texto
    // por segmento. Para isso, renderiza em duas passagens por segmento:
    // acumula operações de texto e as executa após desenhar o retângulo.
    type TextOp = () => void;
    let ops: TextOp[] = [];
    const flushSegment = (bottom: number) => {
      closeSegment(bottom);
      for (const op of ops) op();
      ops = [];
    };

    startSegment();
    y -= padY;
    // Título
    {
      const tl = wrap(title, titleSize, fontBold, innerW);
      for (const l of tl) {
        const yy = y;
        const pg = page;
        ops.push(() => pg.drawText(l, { x: innerX, y: yy - titleSize, size: titleSize, font: fontBold, color: style.accent }));
        y -= titleSize + 4;
      }
      y -= 6;
    }
    for (const it of items) {
      const plain = it.text.replace(/\*\*/g, "");
      const f = it.italic ? fontItalic : font;
      const wrapped = wrap(plain, it.size, f, innerW - it.indent);
      const need = wrapped.length * (it.size + 4) + it.gapAfter;
      if (y - need - padY < margin && wrapped.length <= 6) {
        // Fecha o segmento atual e continua em página nova.
        flushSegment(y - 4);
        newPage();
        startSegment();
        y -= padY;
      }
      // Suporte a "**Rótulo:** texto" na primeira linha (negrito parcial).
      const boldMatch = it.text.match(/^(•\s*)?\*\*(.+?)\*\*\s*(.*)$/);
      for (let li = 0; li < wrapped.length; li++) {
        if (y - (it.size + 4) - padY < margin) {
          flushSegment(y - 4);
          newPage();
          startSegment();
          y -= padY;
        }
        const yy = y;
        const pg = page;
        const x = innerX + it.indent;
        const line = wrapped[li];
        if (li === 0 && boldMatch && !it.italic) {
          const prefix = boldMatch[1] ?? "";
          const label = boldMatch[2];
          const head = `${prefix}${label}`;
          const headW = fontBold.widthOfTextAtSize(head, it.size);
          const rest = line.slice(head.length);
          ops.push(() => {
            pg.drawText(head, { x, y: yy - it.size, size: it.size, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
            pg.drawText(rest, { x: x + headW, y: yy - it.size, size: it.size, font: f, color: rgb(0.12, 0.12, 0.18) });
          });
        } else {
          const color = it.italic ? rgb(0.3, 0.3, 0.36) : rgb(0.12, 0.12, 0.18);
          ops.push(() => pg.drawText(line, { x, y: yy - it.size, size: it.size, font: f, color }));
        }
        y -= it.size + 4;
      }
      y -= it.gapAfter;
    }
    y -= padY;
    flushSegment(y);
    y -= 10;
  };

  // Apostila page-break bookkeeping. Página 1: cabeçalho + Apresentação +
  // Objetivos (Geral e Específicos) fluindo em sequência, sem quebras internas.
  // Página 2: Sumário. Da página 3 em diante: cada AULA inicia em página nova e
  // a seção de Referências também. O título de Módulo é apenas um separador e
  // não força quebra por si só.
  let apostilaSeenSumario = false;


  for (const sec of sections) {
    if (sec.heading) {
      ensureSpace(20);
      y -= 6;
      for (const l of wrap(sec.heading, 13, fontBold)) drawLine(l, 13, fontBold, rgb(0.15, 0.15, 0.25));
      y -= 2;
    }

    // Walk lines and group consecutive markdown table rows (| col | col |)
    const lines = sec.lines;
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      // Table-of-contents marker line (apostila sumário entry).
      if (ln.startsWith(TOC_MARKER)) {
        const m = ln.match(/^@@TOC@@(\d)@@(.*)$/);
        if (m) {
          const level = Number(m[1]);
          const text = m[2];
          const pageNum = opts.tocPageMap?.get(`${level}|${text}`);
          drawTocEntry(level, text, pageNum);
        }
        i++;
        continue;
      }
      if (isMarkdownTableRow(ln)) {
        const tableLines: string[] = [];
        while (i < lines.length && isMarkdownTableRow(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        const parsed = parseMarkdownTable(tableLines);
        if (parsed.length > 0) {
          y -= 4;
          drawTable(parsed);
          y -= 6;
          continue;
        }
      }
      const isHeading = /^#{1,6}\s/.test(ln);
      const headingLevelMatch = ln.match(/^(#{1,6})\s/);
      const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 0;
      const stripped = ln.replace(/^#{1,6}\s*/, "");
      if (stripped.trim()) {
        const clean = stripped
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/\*\*+/g, "")
          .trim();
        const atPageTop = y >= pageHeight - margin - 2;
        // Decide quebras de página para apostilas com base na semântica do
        // título, não apenas no nível markdown.
        let apostilaBreak = false;
        if (opts.apostilaPageBreaks && (headingLevel === 2 || headingLevel === 3)) {
          const isSumario = /^sum[áa]rio$/i.test(clean);
          const isModulo = headingLevel === 2 && /^m[óo]dulo\b/i.test(clean);
          const isAula = headingLevel === 3 && /^aula\b/i.test(clean);
          const isReferencias = headingLevel === 2 && /^refer[êe]ncias\b/i.test(clean);
          const isIntro =
            /^(apresenta[çc][ãa]o|objetivos?\b.*)$/i.test(clean) && !apostilaSeenSumario;
          if (isSumario) {
            apostilaBreak = true;
            apostilaSeenSumario = true;
          } else if (isModulo || isReferencias) {
            // Módulos e Referências quebram página obrigatoriamente.
            apostilaBreak = true;
          } else if (isIntro || isAula) {
            // Aulas fluem continuadamente dentro do módulo no PDF também.
            apostilaBreak = false;
          } else if (headingLevel === 2 && apostilaSeenSumario) {
            apostilaBreak = true;
          }
        }

        const forcePageBreak =
          (PAGE_BREAK_HEADINGS.test(clean) || apostilaBreak) && !atPageTop;
        if (forcePageBreak) newPage();
        
        // Emula margin-top: 2rem para Aulas em fluxo contínuo.
        if (!forcePageBreak && !atPageTop) {
          if (opts.apostilaPageBreaks && headingLevel === 3 && /^aula\b/i.test(clean)) {
             y -= 24;
          } else {
             y -= 8;
          }
        }

        // Evita título órfão no pé da página.
        if (y < margin + 110 && !atPageTop) {
          newPage();
        }

        // page-break-inside: avoid — título seguido de tabela (ex.: cabeçalho
        // de Módulo + cronograma do plano de aula). Mede o bloco completo:
        // se não couber no espaço restante e couber em uma página inteira,
        // move cabeçalho + tabela juntos para a próxima página. Se a tabela
        // for maior que uma página, garante ao menos o título + cabeçalho +
        // duas linhas na mesma página.
        if (isHeading && !atPageTop) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && isMarkdownTableRow(lines[j])) {
            const tableLines: string[] = [];
            let k = j;
            while (k < lines.length && isMarkdownTableRow(lines[k])) {
              tableLines.push(lines[k]);
              k++;
            }
            const parsedNext = parseMarkdownTable(tableLines);
            if (parsedNext.length > 0) {
              const headingSize = 12;
              const headingH = wrap(clean, headingSize, fontBold).length * (headingSize + 4) + 10;
              const layout = layoutTable(parsedNext);
              const usableH = pageHeight - margin * 2;
              const blockH = headingH + layout.totalH;
              const minKeep = headingH + layout.rowHeights.slice(0, 3).reduce((a, b) => a + b, 0);
              const remainingH = y - margin;
              if ((blockH > remainingH && blockH <= usableH) || minKeep > remainingH) {
                newPage();
              }
            }
          }
          // Módulo prático: cabeçalho "### Módulo X (Módulo Prático ...)" seguido
          // (após a linha de apoio) pela caixa "#### Dinâmica das Atividades
          // Práticas". Mantém título + início da caixa na mesma página.
          if (headingLevel === 3 && /^m[óo]dulo\b/i.test(clean)) {
            let k = j;
            let steps = 0;
            while (k < lines.length && steps < 4 && !/^#{4}\s/.test(lines[k])) {
              k++;
              steps++;
            }
            if (k < lines.length && /^#{4}\s+din[âa]mica das atividades pr[áa]ticas/i.test(lines[k])) {
              const minKeepH = 150;
              if (y - margin < minKeepH) newPage();
            }
          }
        }

        // Record the page where module/lesson headings begin so a later pass
        // can resolve table-of-contents page numbers.
        if (opts.collectHeadingPages && headingLevel >= 2 && headingLevel <= 4) {
          if (y < margin + 12 + 4) newPage();
          opts.collectHeadingPages.set(`${headingLevel}|${clean}`, pageNo);
        }

        // BANCO DE TEMAS SUGERIDOS — categorias em caixas visuais nítidas.
        if (headingLevel === 4 && THEME_BOX_HEADINGS.test(clean)) {
          const boxLines: string[] = [];
          let k = i + 1;
          while (k < lines.length && !/^#{1,6}\s/.test(lines[k])) {
            boxLines.push(lines[k]);
            k++;
          }
          // Remove linhas vazias no fim do bloco.
          while (boxLines.length && !boxLines[boxLines.length - 1].trim()) boxLines.pop();
          drawThemeBox(clean, boxLines);
          i = k;
          continue;
        }

        // CONCEPT MAP JSON BLOCK (PDF Export)
        if (ln.trim() === "```concept-map-json") {
          let jsonStr = "";
          i++;
          while (i < lines.length && lines[i].trim() !== "```") {
            jsonStr += lines[i] + "\n";
            i++;
          }
          i++;
          try {
            const cleanJson = jsonStr
              .replace(/```json\s*/gi, "")
              .replace(/```\s*/g, "")
              .trim();
            const data = JSON.parse(cleanJson);

            // Node/Card diagram implementation for PDF
            const central = data.tema_central || "Tema";
            const branches = data.nos_secundarios || [];

            // 1. Cabeçalho do Mapa (Caixa Azul)
            const headerH = 36;
            if (y < margin + headerH + 20) newPage();
            const navy = rgb(0.06, 0.09, 0.16); // #0f172a
            page.drawRectangle({
              x: margin,
              y: y - headerH,
              width: maxWidth,
              height: headerH,
              color: navy,
            });
            const teal = rgb(0.05, 0.58, 0.53); // #0d9488
            const bgLight = rgb(0.97, 0.98, 0.99); // #f8fafc
            const border = rgb(0.89, 0.91, 0.94); // #e2e8f0

            // 1. Cabeçalho do Mapa (Caixa Azul)
            const centralText = `TEMA CENTRAL: ${sanitizeWinAnsi(central.toUpperCase())}`;
            const centralSize = 12;
            const hTextW = fontBold.widthOfTextAtSize(centralText, centralSize);
            page.drawText(centralText, {
              x: margin + (maxWidth - hTextW) / 2,
              y: y - headerH / 2 - 7 + 2,
              size: centralSize,
              font: fontBold,
              color: rgb(1, 1, 1),
            });
            // Linha Teal inferior no cabeçalho
            page.drawRectangle({ x: margin, y: y - headerH, width: maxWidth, height: 2, color: teal });
            y -= headerH;

            // 2. Tabela Matriz
            const col1W = maxWidth * 0.25;
            const col2W = maxWidth * 0.20;
            const col3W = maxWidth * 0.55;
            const fontSize = 9;
            const cellPad = 8;

            // Header da Tabela
            const thH = 28;
            if (y < margin + thH + 40) newPage();
            
            const drawTh = (txt: string, x: number, w: number, align: 'left' | 'center' = 'left') => {
              page.drawRectangle({ x, y: y - thH, width: w, height: thH, color: rgb(0.93, 0.95, 0.98), borderColor: border, borderWidth: 0.5 });
              const tw = fontBold.widthOfTextAtSize(txt, 8);
              page.drawText(txt, {
                x: align === 'center' ? x + (w - tw) / 2 : x + cellPad,
                y: y - thH + (thH - 8) / 2 + 1,
                size: 8, font: fontBold, color: navy
              });
            };

            drawTh("CONCEITO PRINCIPAL", margin, col1W);
            drawTh("RELAÇÃO", margin + col1W, col2W, 'center');
            drawTh("SUBTÓPICOS & DETALHES", margin + col1W + col2W, col3W);
            y -= thH;

            for (const node of branches) {
              // Pre-wrap content to calculate row height
              const c1Lines = wrap(sanitizeWinAnsi(node.titulo), fontSize, fontBold, col1W - cellPad * 2);
              const relText = sanitizeWinAnsi((node.relacao || "engloba").toUpperCase() + " ->");
              const relSize = 7;
              const relW = fontBold.widthOfTextAtSize(relText, relSize);
              
              const detailItems = (node.detalhes || []).map((d: any) => {
                const title = sanitizeWinAnsi(d.titulo);
                const sub = d.relacao ? sanitizeWinAnsi(`(${d.relacao})`) : "";
                const titleLines = wrap(title, fontSize, fontBold, col3W - cellPad * 2 - 12);
                const subLines = sub ? wrap(sub, 7, fontItalic, col3W - cellPad * 2 - 12) : [];
                return { titleLines, subLines };
              });

              let c3H = cellPad * 2;
              detailItems.forEach((item: { titleLines: string[], subLines: string[] }) => {
                c3H += item.titleLines.length * 11;
                if (item.subLines.length) c3H += item.subLines.length * 9;
                c3H += 6; // gap between items
              });

              const rowH = Math.max(c1Lines.length * 11 + cellPad * 2, c3H, 30);

              if (y < margin + rowH + 5) {
                newPage();
                y -= 5;
              }

              const rowY = y;
              // Col 1: Conceito
              page.drawRectangle({ x: margin, y: rowY - rowH, width: col1W, height: rowH, color: bgLight, borderColor: border, borderWidth: 0.5 });
              let ty1 = rowY - cellPad - fontSize;
              for (const line of c1Lines) {
                page.drawText(line, { x: margin + cellPad, y: ty1, size: fontSize, font: fontBold, color: navy });
                ty1 -= 11;
              }

              // Col 2: Relação (Badge)
              page.drawRectangle({ x: margin + col1W, y: rowY - rowH, width: col2W, height: rowH, borderColor: border, borderWidth: 0.5 });
              const badgeH = 14;
              const badgeW = relW + 10;
              page.drawRectangle({
                x: margin + col1W + (col2W - badgeW) / 2,
                y: rowY - (rowH + badgeH) / 2,
                width: badgeW, height: badgeH,
                color: teal, opacity: 1,
              });
              page.drawText(relText, {
                x: margin + col1W + (col2W - relW) / 2,
                y: rowY - (rowH + relSize) / 2 + 1,
                size: relSize, font: fontBold, color: rgb(1, 1, 1)
              });

              // Col 3: Detalhes
              page.drawRectangle({ x: margin + col1W + col2W, y: rowY - rowH, width: col3W, height: rowH, borderColor: border, borderWidth: 0.5 });
              let ty3 = rowY - cellPad;
              detailItems.forEach((item: { titleLines: string[], subLines: string[] }) => {
                page.drawText("•", { x: margin + col1W + col2W + cellPad, y: ty3 - fontSize, size: fontSize, font: font, color: teal });
                item.titleLines.forEach((l: string) => {
                  page.drawText(l, { x: margin + col1W + col2W + cellPad + 10, y: ty3 - fontSize, size: fontSize, font: fontBold, color: rgb(0.2, 0.2, 0.3) });
                  ty3 -= 11;
                });
                item.subLines.forEach((l: string) => {
                  page.drawText(l, { x: margin + col1W + col2W + cellPad + 10, y: ty3 - 7, size: 7, font: fontItalic, color: rgb(0.5, 0.5, 0.5) });
                  ty3 -= 9;
                });
                ty3 -= 4;
              });

              y -= rowH;
            }
            y -= 20;
          } catch (e) {
            drawLine("Erro ao renderizar tabela matriz (JSON inválido)", 10, fontItalic, rgb(0.8, 0.2, 0.2));
          }
          continue;
        }


        if (isHeading) {
          for (const l of wrap(clean, 12, fontBold)) drawLine(l, 12, fontBold);
        } else if (PAGE_BREAK_HEADINGS.test(clean)) {
          for (const l of wrap(clean, 12, fontBold)) drawLine(l, 12, fontBold);
        } else {
          // Convert markdown bullet/list markers ("- ", "* ", "+ ", "•")
          // into a clean bullet glyph so they don't render as literal
          // asterisks or hyphens in the PDF. Preserve leading indentation.
          // Caixas de destaque (blockquotes ">") viram citações recuadas em
          // itálico, sem exibir o marcador ">" literalmente.
          const bqMatch = stripped.match(/^\s*>+\s?(.*)$/);
          const body = bqMatch ? bqMatch[1] : stripped;
          if (!body.trim()) {
            y -= 4;
          } else {
            const bulletMatch = body.match(/^(\s*)([-*+•])\s+(.*)$/);
            const normalized = bulletMatch
              ? `${bulletMatch[1]}• ${bulletMatch[3]}`
              : body;
            drawRichLine(
              normalized,
              11,
              bqMatch ? rgb(0.28, 0.28, 0.34) : rgb(0.1, 0.1, 0.15),
              bqMatch ? { italic: true, indentX: 16 } : {},
            );
          }
        }
      } else {
        y -= 4;
      }
      i++;
    }
  }

  // Footer page numbers ("Página X de Y") on every page.
  if (opts.pageNumbers) {
    const pages = pdf.getPages();
    const total = pages.length;
    pages.forEach((p, idx) => {
      const label = `Página ${idx + 1} de ${total}`;
      const w = font.widthOfTextAtSize(label, 9);
      p.drawText(label, {
        x: (pageWidth - w) / 2,
        y: margin * 0.5,
        size: 9,
        font,
        color: rgb(0.45, 0.45, 0.5),
      });
    });
  }

  return pdf.save();
}

async function drawConceptMapDiagramPDF(
  page: any,
  pdf: any,
  data: any,
  y: number,
  margin: number,
  pageWidth: number,
  maxWidth: number,
  font: any,
  fontBold: any
): Promise<number> {
  const central = data.tema_central || "Tema";
  const branches = data.nos_secundarios || [];
  const teal = rgb(0.05, 0.58, 0.53); // #0d9488
  const darkNavy = rgb(0.06, 0.09, 0.16); // #0f172a
  const bgLight = rgb(0.97, 0.98, 0.99); // #f8fafc
  const slate600 = rgb(0.29, 0.33, 0.41);
  const slate400 = rgb(0.58, 0.63, 0.72);

  // Helper for new page in diagram
  let currentPage = page;
  let currentY = y;
  const checkSpace = (needed: number) => {
    if (currentY - needed < margin + 40) {
      currentPage = pdf.addPage([pageWidth, 842]);
      currentY = 842 - margin;
      return true;
    }
    return false;
  };


  checkSpace(60);
  
  // Nó Principal
  const centralText = central.toUpperCase();
  const centralSize = 12;
  const centralW = Math.min(maxWidth, fontBold.widthOfTextAtSize(centralText, centralSize) + 40);
  const centralH = 32;
  const centralX = margin + (maxWidth - centralW) / 2;
  
  currentPage.drawRectangle({
    x: centralX,
    y: currentY - centralH,
    width: centralW,
    height: centralH,
    color: darkNavy,
    opacity: 1,
    borderWidth: 1,
    borderColor: rgb(1,1,1),
  });
  
  currentPage.drawText(centralText, {
    x: centralX + (centralW - fontBold.widthOfTextAtSize(centralText, centralSize)) / 2,
    y: currentY - centralH + (centralH - centralSize) / 2 + 2,
    size: centralSize,
    font: fontBold,
    color: rgb(1,1,1),
  });
  
  currentY -= (centralH + 20);

  // Ramos em 2 colunas
  const colW = (maxWidth - 20) / 2;
  let leftY = currentY;
  let rightY = currentY;

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const isLeft = i % 2 === 0;
    const colX = isLeft ? margin : margin + colW + 20;
    let targetY = isLeft ? leftY : rightY;

    // Medir altura do branch
    const titleSize = 10;
    const relSize = 8;
    const detailSize = 9;
    const padding = 12;
    let branchH = padding * 2 + titleSize + 6;
    
    (branch.detalhes || []).forEach(() => {
      branchH += (detailSize + 8);
    });

    if (checkSpace(branchH)) {
      targetY = 842 - margin;
      leftY = targetY;
      rightY = targetY;
    }

    // Card background
    currentPage.drawRectangle({
      x: colX,
      y: targetY - branchH,
      width: colW,
      height: branchH,
      color: bgLight,
    });
    
    // Teal left border
    currentPage.drawLine({
      start: { x: colX, y: targetY },
      end: { x: colX, y: targetY - branchH },
      thickness: 4,
      color: teal,
    });

    // Relação Badge
    const relText = (branch.relacao || "contém").toUpperCase();
    const relW = fontBold.widthOfTextAtSize(relText, relSize) + 8;
    currentPage.drawRectangle({
      x: colX + padding,
      y: targetY - padding - relSize - 2,
      width: relW,
      height: relSize + 4,
      color: teal,
      opacity: 0.1,
    });
    currentPage.drawText(relText, {
      x: colX + padding + 4,
      y: targetY - padding - relSize + 1,
      size: relSize,
      font: fontBold,
      color: teal,
    });

    const branchTitleText = String(branch.titulo || "");
    const maxTitleW = colW - padding * 2 - relW - 10;
    const branchTitleDisplay = fontBold.widthOfTextAtSize(branchTitleText, titleSize) > maxTitleW
      ? branchTitleText.slice(0, Math.floor(maxTitleW / (titleSize * 0.6))) + "..."
      : branchTitleText;

    currentPage.drawText(branchTitleDisplay, {
      x: colX + padding + relW + 6,
      y: targetY - padding - titleSize + 1,
      size: titleSize,
      font: fontBold,
      color: darkNavy,
    });

    let dy = targetY - padding - titleSize - 12;
    (branch.detalhes || []).forEach((detail: any) => {
      // Conector ➔ (horizontal placement to avoid overlap)
      const connectorPrefix = "➔ " + (detail.relacao || "");
      currentPage.drawText(connectorPrefix, {
        x: colX + padding + 8,
        y: dy - detailSize + 1,
        size: relSize,
        font,
        color: slate400,
      });
      
      const connectorW = font.widthOfTextAtSize(connectorPrefix, relSize);
      
      // Detalhe texto (placed side-by-side with connector using a 6px gap)
      currentPage.drawText(detail.titulo || "", {
        x: colX + padding + 8 + connectorW + 6,
        y: dy - detailSize + 1,
        size: detailSize,
        font: fontBold,
        color: darkNavy,
      });
      
      dy -= (detailSize + 8);
    });

    if (isLeft) leftY = targetY - branchH - 20;
    else rightY = targetY - branchH - 20;
  }

  return Math.min(leftY, rightY);
}

function isMarkdownTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|", 1);
}

function parseMarkdownTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const raw of lines) {
    const t = raw.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = t.split("|").map((c) => c.trim());
    // Skip the separator row like | --- | --- |
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function generationToSections(tool: string, rawResult: unknown, title?: string, logoUrl?: string | null): { sections: Array<{ heading?: string; lines: string[] }> } {
  const s: Array<{ heading?: string; lines: string[] }> = [];
  let markdown = normalizeAIContent(rawResult).trim();
  if (tool === "lesson_plan" && markdown) {
    markdown = ensureLessonPlanStandardHeader(markdown, { fallbackTitle: title, logoUrl });
  }
  if (tool === "apostila" && markdown) {
    // Promote plain front-matter titles (Apresentação/Objetivos/Sumário) to
    // "## " headings so the two-pass Sumário (own page + page numbers) works.
    markdown = normalizeApostilaMarkdown(markdown);
  }
  if (markdown && (typeof rawResult === "string" || markdown.startsWith("#"))) {
    return { sections: [{ lines: markdown.split(/\r?\n/) }] };
  }
  const result: AnyObj = rawResult && typeof rawResult === "object" ? rawResult as AnyObj : {};
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
  const obj = (v: unknown): AnyObj => (v && typeof v === "object" ? v as AnyObj : {});

  switch (tool) {
    case "lesson_plan":
      if (typeof result.markdown === "string") {
        s.push({ lines: ensureLessonPlanStandardHeader(String(result.markdown), { fallbackTitle: title, logoUrl }).split(/\r?\n/) });
      } else {
        s.push({ heading: "Objetivos", lines: arr(result.objectives).map((o, i) => `${i + 1}. ${o}`) });
        s.push({ heading: "Materiais", lines: arr(result.materials).map((m) => `• ${m}`) });
        s.push({ heading: `Etapas (${result.duration_minutes ?? "?"} min)`, lines:
          (result.stages as AnyObj[] | undefined ?? []).map((st) => `• ${st.name} (${st.minutes}min): ${st.activities}`)
        });
        if (result.assessment) s.push({ heading: "Avaliação", lines: [String(result.assessment)] });
        if (result.homework) s.push({ heading: "Tarefa", lines: [String(result.homework)] });
      }
      break;
    case "exercise_list":
      if (result.instructions) s.push({ heading: "Instruções", lines: [String(result.instructions)] });
      (result.questions as AnyObj[] | undefined ?? []).forEach((q, i) => {
        s.push({ heading: `Questão ${i + 1}`, lines: [
          String(q.prompt ?? ""),
          ...(Array.isArray(q.options) ? (q.options as string[]).map((o, oi) => `   ${String.fromCharCode(97 + oi)}) ${o}`) : []),
          `Resposta: ${q.answer ?? "—"}`,
          q.explanation ? `Explicação: ${q.explanation}` : "",
        ].filter(Boolean) });
      });
      break;
    case "syllabus":
      if (result.summary) s.push({ heading: "Ementa", lines: [String(result.summary)] });
      s.push({ heading: "Objetivos", lines: arr(result.objectives).map((o) => `• ${o}`) });
      (result.content_units as AnyObj[] | undefined ?? []).forEach((u) => {
        s.push({ heading: `Unidade: ${u.name}`, lines: arr(u.topics).map((t) => `• ${t}`) });
      });
      if (result.methodology) s.push({ heading: "Metodologia", lines: [String(result.methodology)] });
      if (result.evaluation) s.push({ heading: "Avaliação", lines: [String(result.evaluation)] });
      s.push({ heading: "Bibliografia básica", lines: arr(result.bibliography_basic).map((b) => `• ${b}`) });
      s.push({ heading: "Bibliografia complementar", lines: arr(result.bibliography_complementary).map((b) => `• ${b}`) });
      break;
    case "rubric":
      (result.criteria as AnyObj[] | undefined ?? []).forEach((c) => {
        s.push({ heading: `${c.name} (peso ${c.weight})`, lines:
          (c.levels as AnyObj[] | undefined ?? []).map((lv) => `• ${lv.label} (${lv.score}): ${lv.descriptor}`)
        });
      });
      break;
    case "case_study":
      if (result.context) s.push({ heading: "Contexto", lines: [String(result.context)] });
      if (result.narrative) s.push({ heading: "Narrativa", lines: [String(result.narrative)] });
      s.push({ heading: "Personagens", lines: (result.characters as AnyObj[] | undefined ?? []).map((c) => `• ${c.name} — ${c.role}`) });
      s.push({ heading: "Questões para discussão", lines: arr(result.questions).map((q, i) => `${i + 1}. ${q}`) });
      s.push({ heading: "Conceitos esperados", lines: arr(result.expected_concepts).map((c) => `• ${c}`) });
      break;
    case "summary":
      if (result.abstract) s.push({ heading: "Resumo", lines: [String(result.abstract)] });
      s.push({ heading: "Pontos-chave", lines: arr(result.key_points).map((k) => `• ${k}`) });
      (result.sections as AnyObj[] | undefined ?? []).forEach((sec) => {
        s.push({ heading: String(sec.heading ?? ""), lines: [String(sec.content ?? "")] });
      });
      s.push({ heading: "Glossário", lines: (result.glossary as AnyObj[] | undefined ?? []).map((g) => `• ${g.term}: ${g.meaning}`) });
      break;
    case "quiz":
      if (result.instructions) s.push({ heading: "Instruções", lines: [String(result.instructions), `Tempo: ${result.time_minutes ?? "—"} min`] });
      (result.questions as AnyObj[] | undefined ?? []).forEach((q, i) => {
        s.push({ heading: `${i + 1}. (${q.points ?? 1} pts) ${q.prompt ?? ""}`, lines: [
          ...(Array.isArray(q.options) ? (q.options as string[]).map((o, oi) => `   ${String.fromCharCode(97 + oi)}) ${o}`) : []),
          `Gabarito: ${typeof q.correct_index === "number" && Array.isArray(q.options) ? (q.options as string[])[q.correct_index] : "—"}`,
          q.explanation ? `Explicação: ${q.explanation}` : "",
        ].filter(Boolean) });
      });
      break;
    case "essay_prompt":
      if (result.theme) s.push({ heading: "Tema", lines: [String(result.theme)] });
      (result.supporting_texts as AnyObj[] | undefined ?? []).forEach((t, i) => {
        s.push({ heading: `Texto de apoio ${i + 1}: ${t.title ?? ""}`, lines: [String(t.excerpt ?? "")] });
      });
      if (result.instructions) s.push({ heading: "Instruções", lines: [String(result.instructions)] });
      s.push({ heading: "Foco da rubrica", lines: arr(result.rubric_focus).map((r) => `• ${r}`) });
      s.push({ heading: "Tamanho", lines: [`${result.min_words ?? 0}–${result.max_words ?? 0} palavras`] });
      break;
    case "concept_map":
      if (result.central_concept) s.push({ heading: "Conceito central", lines: [String(result.central_concept)] });
      s.push({ heading: "Nós", lines: (result.nodes as AnyObj[] | undefined ?? []).map((n) => `• ${n.id}: ${n.label}`) });
      s.push({ heading: "Conexões", lines: (result.edges as AnyObj[] | undefined ?? []).map((e) => `${e.from} → [${e.label}] → ${e.to}`) });
      break;
    case "study_guide":
      if (result.overview) s.push({ heading: "Visão geral", lines: [String(result.overview)] });
      (result.sections as AnyObj[] | undefined ?? []).forEach((sec) => {
        s.push({ heading: String(sec.heading ?? ""), lines: [
          String(sec.what_to_study ?? ""),
          ...arr(sec.tips).map((t) => `• Dica: ${t}`),
        ] });
      });
      s.push({ heading: "Auto-checagem", lines: arr(result.self_check_questions).map((q, i) => `${i + 1}. ${q}`) });
      s.push({ heading: "Recursos extras", lines: arr(result.extra_resources).map((r) => `• ${r}`) });
      break;
    case "feedback_template":
      if (result.tone) s.push({ heading: "Tom", lines: [String(result.tone)] });
      (result.blocks as AnyObj[] | undefined ?? []).forEach((b) => {
        s.push({ heading: String(b.label ?? ""), lines: [String(b.template ?? "")] });
      });
      s.push({ heading: "Frases de melhoria", lines: arr(result.improvement_phrases).map((p) => `• ${p}`) });
      s.push({ heading: "Frases de incentivo", lines: arr(result.encouragement_phrases).map((p) => `• ${p}`) });
      break;
    case "slides":

      // PDF version: each slide as a section
      if (result.subtitle) s.push({ lines: [String(result.subtitle)] });
      (result.slides as AnyObj[] | undefined ?? []).forEach((sl, i) => {
        s.push({ heading: `Slide ${i + 1}: ${sl.title ?? ""}`, lines: [
          ...arr(sl.bullets).map((b) => `• ${b}`),
          sl.notes ? `Notas: ${sl.notes}` : "",
        ].filter(Boolean) });
      });
      break;
    default:
      s.push({ heading: "Conteúdo", lines: [JSON.stringify(result, null, 2)] });
  }
  return { sections: s };
}

/**
 * Renders a "Materiais Didáticos" entry (title/description/markdown) to a PDF
 * using the SAME rich renderer teachers get for generated documents, so the file
 * a student downloads is identical to the teacher's version — tables, the
 * standardized header (logo + Curso/Disciplina/Professor), and the landscape
 * lesson-plan layout are all preserved.
 */
export async function buildMaterialDocumentPDF(
  title: string,
  description: string | null,
  content: string | null,
  logoUrl?: string | null,
): Promise<Uint8Array> {
  let md = normalizeAIContent(content ?? "").trim();
  
  // Detect document type for header
  const isLessonPlan = /\*\*PLANO DE AULA\*\*/i.test(md) || /Cronograma Detalhado/i.test(md);
  const isActivity = /\*\*GUIA DE ATIVIDADE\*\*/i.test(md) || /\*\*ATIVIDADE\*\*/i.test(md);
  const isWork = /\*\*TRABALHO ACADÊMICO\*\*/i.test(md) || /\*\*EMENTA — TRABALHO\*\*/i.test(md);
  
  const hasStandardHeader = /\*\*Disciplina:\*\*/.test(md.slice(0, 800));
  
  if (isLessonPlan) {
    md = ensureLessonPlanStandardHeader(md, { fallbackTitle: title, logoUrl: logoUrl ?? null });
  } else if (!hasStandardHeader) {
    // If it doesn't have a header, try to build one for generic materials
    try {
       const headerType = isActivity ? "GUIA DE ATIVIDADE" : isWork ? "TRABALHO ACADÊMICO" : "MATERIAL DIDÁTICO";
       const header = [
         logoUrl ? `![Logo](${logoUrl})` : "",
         `**${headerType}**`,
         `**Título:** ${title}`,
         description ? `**Descrição:** ${description}` : "",
         "---",
         ""
       ].filter(Boolean).join("\n");
       md = `${header}\n${md}`;
    } catch (e) {
       console.warn("[buildMaterialDocumentPDF] Failed to inject dynamic header", e);
    }
  }

  // Apostilas process
  const isApostila =
    !isLessonPlan &&
    (/\*\*Apostila:\*\*/i.test(md.slice(0, 800)) ||
      (/^##\s+sum[áa]rio\s*$/im.test(md) && /^##\s+m[óo]dulo/im.test(md)));
      
  if (isApostila) {
    const sections = [{ lines: normalizeApostilaMarkdown(md).split(/\r?\n/) }];
    const headingPages = new Map<string, number>();
    const clone = () => JSON.parse(JSON.stringify(sections)) as typeof sections;
    await renderToPDF("", clone(), {
      buildTOC: true,
      pageNumbers: true,
      collectHeadingPages: headingPages,
      apostilaPageBreaks: true,
    });
    return renderToPDF("", clone(), {
      buildTOC: true,
      pageNumbers: true,
      tocPageMap: headingPages,
      apostilaPageBreaks: true,
    });
  }
  const lines: string[] = md.split(/\r?\n/);
  const titleForPdf = isLessonPlan || /\*\*Disciplina:\*\*/.test(md.slice(0, 800)) ? "" : title;
  return renderToPDF(titleForPdf, [{ lines }], { landscape: isLessonPlan });
}



export const exportGenerationPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const gen = await loadGeneration(data.id, context.userId);
    // Slides: deliver the VISUAL slide PDF (branded layout), not running text.
    if (gen.tool === "slides") {
      const visual = await buildGenerationSlidesPDF(gen, context.userId);
      if (visual) {
        return {
          filename: visual.filename,
          mime: "application/pdf",
          base64: bufferToBase64(visual.bytes),
        };
      }
    }
    const logoUrl = await import("./branding.server").then((m) => m.resolveBrandingLogoUrl(context.userId)).catch(() => null);
    
    const { sections } = generationToSections(gen.tool, gen.result, gen.title, logoUrl);
    // Suppress the top blue title for documents whose markdown already
    // contains a standardized header (e.g. lesson plan, apostila — the
    // header injected by the assistant already shows **Apostila:** <name>).
    const hasStandardHeader = /\*\*Disciplina:\*\*/.test(
      normalizeAIContent(gen.result).slice(0, 600),
    );
    const titleForPdf =
      gen.tool === "lesson_plan" || gen.tool === "apostila" || hasStandardHeader
        ? ""
        : gen.title;
    let bytes: Uint8Array;
    const genId = data.id;
    if (gen.tool === "apostila") {
      // Two-pass render: pass 1 records the page where each module/lesson
      // heading lands; pass 2 uses that map to fill the sumário page numbers.
      const headingPages = new Map<string, number>();
      const clone = () => JSON.parse(JSON.stringify(sections)) as typeof sections;
      await renderToPDF(titleForPdf, clone(), {
        buildTOC: true,
        pageNumbers: true,
        collectHeadingPages: headingPages,
        apostilaPageBreaks: true,
        genId,
      });
      bytes = await renderToPDF(titleForPdf, clone(), {
        buildTOC: true,
        pageNumbers: true,
        tocPageMap: headingPages,
        apostilaPageBreaks: true,
        genId,
      });
    } else {
      bytes = await renderToPDF(titleForPdf, sections, {
        landscape: gen.tool === "lesson_plan",
        genId,
      });
    }
    return {
      filename: `${safeFileName(buildDocumentFilename(gen.title, normalizeAIContent(gen.result))) || "documento"}.pdf`,
      mime: "application/pdf",
      base64: bufferToBase64(bytes),
    };
  });


/* --------------------------- PPTX rendering ------------------------------- */

/**
 * Builds the branded .pptx bytes for a generation. Shared by the export server
 * function (teacher download) and the dispatch flow (so the student receives a
 * real PowerPoint file, not only a static PDF).
 */
export async function buildGenerationPPTX(
  gen: { tool: string; title: string; result: unknown; prompt: unknown },
  userId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
    // Lazy import (large dep)
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const SW = 13.333; // slide width (inches) for LAYOUT_WIDE
    const SH = 7.5; // slide height (inches)
    const FONT = "Arial";

    // Parses inline markdown (**bold**, *italic*, __bold__, _italic_) into runs.
    const parseInlineRuns = (
      text: string,
    ): Array<{ text: string; bold: boolean; italic: boolean }> => {
      const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
      const regex = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text))) {
        if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false, italic: false });
        if (m[1] !== undefined) runs.push({ text: m[1], bold: true, italic: false });
        else if (m[2] !== undefined) runs.push({ text: m[2], bold: true, italic: false });
        else if (m[3] !== undefined) runs.push({ text: m[3], bold: false, italic: true });
        else if (m[4] !== undefined) runs.push({ text: m[4], bold: false, italic: true });
        last = regex.lastIndex;
      }
      if (last < text.length) runs.push({ text: text.slice(last), bold: false, italic: false });
      const out = runs.length ? runs : [{ text, bold: false, italic: false }];
      // Remove marcadores soltos (ex.: negrito/itálico desbalanceado gerado
      // pela IA como "**aumentam a* frequência *de abertura**") para que
      // asteriscos nunca apareçam literalmente no slide.
      for (const r of out) r.text = r.text.replace(/\*+/g, "");
      const cleaned = out.filter((r) => r.text.length > 0);
      return cleaned.length ? cleaned : [{ text: "", bold: false, italic: false }];
    };
    // Removes markdown emphasis markers (for text that is already styled).
    const stripMd = (text: string): string =>
      text
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1");
    // Converts a single string into pptxgenjs rich-text runs honoring markdown.
    const mdRuns = (text: string, base: { bold?: boolean; italic?: boolean } = {}) =>
      parseInlineRuns(text).map((r) => ({
        text: r.text,
        options: { bold: base.bold || r.bold, italic: base.italic || r.italic },
      }));
    // Converts bullet items into rich-text runs with per-line bullets.
    const mdBulletRuns = (items: string[], indent = 18) => {
      const out: Array<{ text: string; options: Record<string, unknown> }> = [];
      items.forEach((item) => {
        const runs = parseInlineRuns(item);
        runs.forEach((r, i) => {
          out.push({
            text: r.text,
            options: {
              bold: r.bold,
              italic: r.italic,
              bullet: i === 0 ? { indent } : false,
              breakLine: i === runs.length - 1,
            },
          });
        });
      });
      return out;
    };

    const resultObj: AnyObj = gen.result && typeof gen.result === "object" ? gen.result as AnyObj : {};
    const slidesMarkdown = gen.tool === "slides" ? normalizeAIContent(gen.result) : "";
    const hasStructuredSlideBlocks =
      gen.tool === "slides" && /^\s*SLIDE\s+\d+\s*:/m.test(slidesMarkdown);

    // Gamma-style branded slides — a pure design system (no background images):
    // a dark impact cover, full-bleed colored module dividers, light content
    // slides with a left accent rail + filled bullet markers, amber callout
    // boxes for warnings, and the institution logo on a chip.
    if (hasStructuredSlideBlocks) {
      const getLogoUrl = async () => {
        try {
          const { resolveBrandingLogoUrl } = await import("./branding.server");
          const { data: genData } = await (supabaseAdmin.from("ai_generations" as never) as unknown as {
            select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { discipline_id: string | null } | null }> } };
          }).select("discipline_id").eq("id", (gen as any).id || "").maybeSingle();

          if (genData?.discipline_id) {
            const { data: disc } = await supabaseAdmin.from("disciplines").select("teacher_id").eq("id", genData.discipline_id).maybeSingle();
            if (disc?.teacher_id) {
              return await resolveBrandingLogoUrl(disc.teacher_id);
            }
          }
        } catch { /* ignore */ }
        return await import("./branding.server")
          .then((m) => m.resolveBrandingLogoUrl(userId))
          .catch(() => null);
      };

      const logoUrl = await getLogoUrl();
      const logoUri = await fetchImageDataUri(logoUrl);

      // Color theme + template chosen by the teacher (stored on the generation).
      const promptObj: AnyObj =
        gen.prompt && typeof gen.prompt === "object" ? (gen.prompt as AnyObj) : {};
      const design = resolveSlideDesign(promptObj.color_theme, promptObj.template);
      const TEMPLATE: SlideTemplateKey = design.template;
      const ACCENTS = design.accents;
      const COVER_BG = design.cover;
      const INK = "0F172A";
      const BODY = "334155";
      const LIGHT_BG = TEMPLATE === "classico" ? "FFFFFF" : "F8FAFC";
      const LIGHT_TXT = "CBD5E1";
      const CALLOUT_BG = "FEF3C7";
      const CALLOUT_TXT = "92400E";
      // Dark-template content tokens (whole deck stays dark).
      const DARK_BG = COVER_BG;
      const DARK_TITLE = "FFFFFF";
      const DARK_BODY = "E2E8F0";
      const DARK_CALLOUT_BG = "422006";
      const DARK_CALLOUT_TXT = "FDE68A";
      const isDark = TEMPLATE === "escuro";

      const blocks = slidesMarkdown
        .split(/^\s*SLIDE\s+\d+\s*:\s*$/im)
        .map((b) => b.trim())
        .filter(Boolean);

      const calloutRe = /^\s*(?:⚠️?|aten[çc][ãa]o|importante|nota|obs)\b[:.\-\s]*/i;
      const isCallout = (t: string) => calloutRe.test(t);
      const stripCallout = (t: string) => t.replace(calloutRe, "").trim();

      const addLogo = (slide: ReturnType<typeof pptx.addSlide>, dark: boolean) => {
        if (!logoUri) return;
        if (dark) {
          slide.addShape(pptx.ShapeType.roundRect, {
            x: SW - 2.05, y: 0.28, w: 1.75, h: 0.74, rectRadius: 0.08,
            fill: { color: "FFFFFF" }, line: { type: "none" },
          });
          slide.addImage({ data: logoUri, x: SW - 1.95, y: 0.36, w: 1.55, h: 0.58, sizing: { type: "contain", w: 1.55, h: 0.58 } });
        } else {
          slide.addImage({ data: logoUri, x: SW - 1.9, y: 0.32, w: 1.55, h: 0.6, sizing: { type: "contain", w: 1.55, h: 0.6 } });
        }
      };

      let moduleIdx = -1;
      let moduleNo = 0;
      let lessonNo = 0;
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let title = "";
        let kind = "";
        const bullets: string[] = [];
        const extras: string[] = [];
        const notes: string[] = [];
        let imageUrl: string | null = null;
        let section: "main" | "extra" | "example" | null = null;
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          let m: RegExpMatchArray | null;
          if ((m = line.match(/^Tipo de Slide\s*:\s*(.*)$/i))) { kind = m[1].trim(); section = null; continue; }
          if ((m = line.match(/^T[íi]tulo do Slide\s*:\s*(.*)$/i))) { title = m[1].trim(); section = null; continue; }
          if (/^Conte[úu]do Principal\s*:?\s*$/i.test(line)) { section = "main"; continue; }
          if (/^Detalhes Adicionais.*:?\s*$/i.test(line)) { section = "extra"; continue; }
          if (/^Sugest[ãa]o de Recurso Visual\s*:/i.test(line)) { section = null; continue; }
          if ((m = line.match(/^Notas do Professor\s*:\s*(.*)$/i))) { notes.push(m[1].trim()); section = null; continue; }
          // Extract image URL from slide content
          if ((m = line.match(/^Imagem:\s*(https?:\/\/[^\s]+)$/i))) { imageUrl = m[1].trim(); section = null; continue; }
          // Extract example practical section
          if ((m = line.match(/^Exemplo Pr[áa]tico\s*:\s*$/i))) { section = "example"; continue; }
          const bm = line.match(/^[-*•]\s+(.*)$/);
          const text = bm ? bm[1].trim() : line;
          if (section === "main") bullets.push(text);
          else if (section === "extra") extras.push(text);
          else if (bullets.length === 0 && !title) title = text;
        }
        const slide = pptx.addSlide();
        const heading = title || kind || "Slide";
        const k = kind.toLowerCase();
        const allBullets = [...bullets, ...extras];
        if (k.includes("módulo") || k.includes("modulo")) { moduleIdx++; moduleNo++; }
        if (k.includes("aula")) lessonNo++;
        const accent = ACCENTS[(moduleIdx < 0 ? 0 : moduleIdx) % ACCENTS.length];

        // Template-driven surfaces.
        const lightCover = TEMPLATE === "classico" || TEMPLATE === "minimalista";
        const dividerFullBleed = TEMPLATE === "moderno" || TEMPLATE === "escuro";
        const contentBg = isDark ? DARK_BG : LIGHT_BG;
        const contentTitleColor = isDark ? DARK_TITLE : INK;
        const contentBodyColor = isDark ? DARK_BODY : BODY;
        const leftRail = TEMPLATE === "moderno";
        const bulletMark =
          TEMPLATE === "minimalista" ? "–  " : TEMPLATE === "classico" ? "●  " : "▪  ";

        if (k.includes("capa")) {
          // Impact cover (dark for moderno/escuro, light for classico/minimalista).
          slide.background = { color: lightCover ? "FFFFFF" : COVER_BG };
          addLogo(slide, !lightCover);
          slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.35, w: 0.16, h: 1.7, fill: { color: accent }, line: { type: "none" } });
          slide.addText("APRESENTAÇÃO DE AULA",
            { x: 1.3, y: 1.8, w: SW - 3, h: 0.4, fontSize: 15, bold: true, color: accent, charSpacing: 3, fontFace: FONT });
          slide.addText(stripMd(heading || (resultObj.title as string) || "Apresentação"),
            { x: 1.25, y: 2.25, w: SW - 3, h: 2.0, fontSize: 44, bold: true, color: lightCover ? INK : "FFFFFF", align: "left", valign: "top", fontFace: FONT });
          if (allBullets.length) {
            slide.addText(mdRuns(allBullets.join("\n")),
              { x: 1.3, y: 4.5, w: SW - 3, h: 2.2, fontSize: 19, color: lightCover ? BODY : LIGHT_TXT, align: "left", lineSpacingMultiple: 1.35, fontFace: FONT });
          }
        } else if (k.includes("módulo") || k.includes("modulo") || k.includes("aula")) {
          const label = k.includes("aula")
            ? `AULA ${lessonNo || 1}`
            : `MÓDULO ${String(moduleNo).padStart(2, "0")}`;
          if (dividerFullBleed) {
            // Full-bleed colored section divider.
            slide.background = { color: accent };
            addLogo(slide, true);
            slide.addText(label,
              { x: 1, y: 2.5, w: SW - 2, h: 0.5, fontSize: 19, bold: true, color: "FFFFFF", align: "center", charSpacing: 4, fontFace: FONT });
            slide.addText(stripMd(heading),
              { x: 1, y: 3.05, w: SW - 2, h: 2, fontSize: 40, bold: true, color: "FFFFFF", align: "center", valign: "top", fontFace: FONT });
            slide.addShape(pptx.ShapeType.rect, { x: SW / 2 - 0.6, y: 5.2, w: 1.2, h: 0.08, fill: { color: "FFFFFF" }, line: { type: "none" } });
          } else if (TEMPLATE === "classico") {
            // Light divider with a bold left accent band.
            slide.background = { color: "FFFFFF" };
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.6, h: SH, fill: { color: accent }, line: { type: "none" } });
            addLogo(slide, false);
            slide.addText(label,
              { x: 1.1, y: 2.6, w: SW - 2.2, h: 0.5, fontSize: 19, bold: true, color: accent, charSpacing: 4, fontFace: FONT });
            slide.addText(stripMd(heading),
              { x: 1.1, y: 3.15, w: SW - 2.2, h: 2, fontSize: 40, bold: true, color: INK, valign: "top", fontFace: FONT });
          } else {
            // Minimalista: white, centered, thin rule.
            slide.background = { color: "FFFFFF" };
            addLogo(slide, false);
            slide.addText(label,
              { x: 1, y: 2.55, w: SW - 2, h: 0.5, fontSize: 18, bold: true, color: accent, align: "center", charSpacing: 5, fontFace: FONT });
            slide.addText(stripMd(heading),
              { x: 1, y: 3.1, w: SW - 2, h: 2, fontSize: 40, bold: true, color: INK, align: "center", valign: "top", fontFace: FONT });
            slide.addShape(pptx.ShapeType.rect, { x: SW / 2 - 0.5, y: 5.15, w: 1.0, h: 0.04, fill: { color: accent }, line: { type: "none" } });
          }
        } else if (k.includes("encerr")) {
          const darkEncerr = !lightCover;
          slide.background = { color: darkEncerr ? COVER_BG : "FFFFFF" };
          addLogo(slide, darkEncerr);
          slide.addShape(pptx.ShapeType.rect, { x: SW / 2 - 0.6, y: 1.65, w: 1.2, h: 0.1, fill: { color: accent }, line: { type: "none" } });
          slide.addText("MENSAGEM DO PROFESSOR",
            { x: 1, y: 1.95, w: SW - 2, h: 0.5, fontSize: 16, bold: true, color: accent, align: "center", charSpacing: 3, fontFace: FONT });
          // O último slide é a mensagem do professor: nunca lista referências.
          const refRe = /(refer[êe]ncia|dispon[íi]vel em|acesso em|\bed\.\s|\b(19|20)\d{2}\b\s*\.|ABNT)/i;
          const msg = allBullets
            .filter((b) => !/^[—-]/.test(b) && !refRe.test(b))
            .join("\n");
          const sign = formatProfessorSignature(
            allBullets.filter((b) => /^[—-]/.test(b)).join("\n"),
          );
          slide.addText(mdRuns(msg, { italic: true }),
            { x: 1.5, y: 2.65, w: SW - 3, h: 2.5, fontSize: 28, italic: true, color: darkEncerr ? "FFFFFF" : INK, align: "center", valign: "middle", lineSpacingMultiple: 1.35, fontFace: FONT });
          if (sign) slide.addText(sign,
            { x: 1.5, y: 5.5, w: SW - 3, h: 0.8, fontSize: 22, bold: true, color: darkEncerr ? LIGHT_TXT : accent, align: "center", fontFace: FONT });
        } else {
          // Content slide.
          slide.background = { color: contentBg };
          if (leftRail) {
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: SH, fill: { color: accent }, line: { type: "none" } });
          }
          addLogo(slide, isDark);
          slide.addText(stripMd(heading),
            { x: leftRail ? 0.75 : 0.6, y: 0.5, w: SW - 2.6, h: 1.1, fontSize: 32, bold: true, color: contentTitleColor, valign: "top", fontFace: FONT });
          const underlineX = leftRail ? 0.78 : 0.62;
          slide.addShape(pptx.ShapeType.rect, {
            x: underlineX, y: 1.55, w: TEMPLATE === "minimalista" ? 0.6 : 0.9, h: TEMPLATE === "minimalista" ? 0.05 : 0.07,
            fill: { color: accent }, line: { type: "none" },
          });

          const normal = allBullets.filter((b) => !isCallout(b));
          const callouts = allBullets.filter((b) => isCallout(b)).map(stripCallout);

          const bx = leftRail ? 0.78 : 0.62;
          const bulletRuns: Array<{ text: string; options: Record<string, unknown> }> = [];
          const bodyItems = normal.slice(0, 8);
          bodyItems.forEach((item) => {
            const runs = parseInlineRuns(emphasizeBulletLabel(item));
            bulletRuns.push({ text: bulletMark, options: { color: accent, bold: true } });
            runs.forEach((r, i) =>
              bulletRuns.push({
                text: r.text,
                options: { color: contentBodyColor, bold: r.bold, italic: r.italic, breakLine: i === runs.length - 1 },
              }),
            );
          });
          if (bulletRuns.length === 0 && callouts.length === 0) bulletRuns.push({ text: "", options: {} });

          // Add slide image if available
          let contentBottomY = 5.2;
          if (imageUrl) {
            try {
              const imageUri = await fetchImageDataUri(imageUrl);
              if (imageUri) {
                // Image at bottom of slide
                slide.addImage({ data: imageUri, x: bx, y: 5.1, w: SW - bx - 0.8, h: 2.1, sizing: { type: "contain", w: SW - bx - 0.8, h: 2.1 } });
                contentBottomY = 5.0;
              }
            } catch { /* ignore image errors */ }
          }

          const bodyH = callouts.length ? 3.3 : contentBottomY - 1.85;
          // Dynamically shrink the body font so dense slides never overflow.
          const bodyW = SW - bx - 0.9;
          let bodyFont = 23;
          for (const candidate of [23, 21, 20, 18, 17, 16, 15, 14, 13, 12]) {
            const charsPerLine = Math.max(10, (bodyW * 72) / (candidate * 0.52));
            const lineH = (candidate * 1.24) / 72;
            let needed = 0;
            for (const item of bodyItems) {
              const len = stripMd(item).length + 2;
              needed += Math.max(1, Math.ceil(len / charsPerLine)) * lineH + 11 / 72;
            }
            bodyFont = candidate;
            if (needed <= bodyH) break;
          }
          if (bulletRuns.length) {
            slide.addText(bulletRuns,
              { x: bx, y: 1.9, w: bodyW, h: bodyH, fontSize: bodyFont, color: contentBodyColor, valign: "top", lineSpacingMultiple: 1.24, paraSpaceAfter: 11, fontFace: FONT, fit: "shrink" });
          }
          if (callouts.length) {
            const cy = contentBottomY - 0.15;
            const cBg = isDark ? DARK_CALLOUT_BG : CALLOUT_BG;
            const cTxt = isDark ? DARK_CALLOUT_TXT : CALLOUT_TXT;
            slide.addShape(pptx.ShapeType.roundRect, {
              x: bx, y: cy, w: SW - bx - 0.9, h: 1.55, rectRadius: 0.1,
              fill: { color: cBg }, line: { color: accent, width: 1.5 },
            });
            const cRuns: Array<{ text: string; options: Record<string, unknown> }> = [];
            callouts.forEach((c) => {
              const runs = parseInlineRuns(c);
              cRuns.push({ text: "⚠  ", options: { color: cTxt, bold: true } });
              runs.forEach((r, i) =>
                cRuns.push({ text: r.text, options: { color: cTxt, bold: r.bold, italic: r.italic, breakLine: i === runs.length - 1 } }),
              );
            });
            slide.addText(cRuns,
              { x: bx + 0.22, y: cy + 0.12, w: SW - bx - 1.3, h: 1.3, fontSize: 17, color: cTxt, valign: "middle", lineSpacingMultiple: 1.2, fontFace: FONT });
          }
        }
        if (notes.length) slide.addNotes(notes.join("\n"));
      }
    } else if (gen.tool === "slides" && slidesMarkdown.includes("---SLIDE---")) {
      // Legacy formats below keep a simple teal cover.
      const cover = pptx.addSlide();
      cover.background = { color: "0E7C7B" };
      cover.addText(gen.title, { x: 0.5, y: 2.5, w: 12, h: 1.5, fontSize: 36, bold: true, color: "FFFFFF", align: "center" });
      const blocks = slidesMarkdown
        .split(/^\s*---SLIDE---\s*$/m)
        .map((b) => b.trim())
        .filter(Boolean);
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let title = "";
        const bullets: string[] = [];
        const notes: string[] = [];
        const visuals: string[] = [];
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          const titleMatch = line.match(/^#{1,4}\s+(.*)$/);
          if (titleMatch && !title) { title = titleMatch[1].trim(); continue; }
          const notesMatch = line.match(/^\**\s*Notas do professor:\**\s*(.*)$/i);
          if (notesMatch) { notes.push(notesMatch[1].trim()); continue; }
          const visualMatch = line.match(/^\**\s*Sugest[ãa]o de recurso visual:\**\s*(.*)$/i);
          if (visualMatch) { visuals.push(visualMatch[1].trim()); continue; }
          const bulletMatch = line.match(/^[-*]\s+(.*)$/);
          if (bulletMatch) { bullets.push(bulletMatch[1].trim()); continue; }
          bullets.push(line);
        }
        const slide = pptx.addSlide();
        slide.addText(title || "Slide", { x: 0.5, y: 0.3, w: 12, h: 0.8, fontSize: 26, bold: true, color: "0E7C7B" });
        const body: { text: string; options?: { bullet?: boolean; italic?: boolean; color?: string } }[] =
          bullets.map((b) => ({ text: b, options: { bullet: true } }));
        for (const v of visuals) body.push({ text: `Sugestão de recurso visual: ${v}`, options: { italic: true, color: "4B5563" } });
        slide.addText(body, { x: 0.5, y: 1.3, w: 12, h: 5.5, fontSize: 18, color: "1F2937" });
        if (notes.length) slide.addNotes(notes.join("\n"));
      }
    } else if (gen.tool === "slides" && Array.isArray(resultObj.slides)) {
      const slides = resultObj.slides as AnyObj[];
      for (const sl of slides) {
        const slide = pptx.addSlide();
        slide.addText(String(sl.title ?? ""), { x: 0.5, y: 0.3, w: 12, h: 0.8, fontSize: 26, bold: true, color: "0E7C7B" });
        const bullets = Array.isArray(sl.bullets) ? (sl.bullets as string[]) : [];
        slide.addText(bullets.map((b) => ({ text: b, options: { bullet: true } })),
          { x: 0.5, y: 1.3, w: 12, h: 5.5, fontSize: 18, color: "1F2937" });
        if (sl.notes) slide.addNotes(String(sl.notes));
      }
    } else {
      // Generic: dump sections, one per slide
      const { sections } = generationToSections(gen.tool, gen.result, gen.title);
      for (const sec of sections) {
        const slide = pptx.addSlide();
        if (sec.heading) {
          slide.addText(sec.heading, { x: 0.5, y: 0.3, w: 12, h: 0.8, fontSize: 24, bold: true, color: "0E7C7B" });
        }
        const lines = sec.lines.filter(Boolean);
        slide.addText(lines.join("\n"), { x: 0.5, y: 1.3, w: 12, h: 5.8, fontSize: 16, color: "1F2937", valign: "top" });
      }
    }

    const arrayBuf = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
    const bytes = new Uint8Array(arrayBuf);
    return {
      filename: `${gen.title.replace(/[^\w\s-]/g, "").trim() || "apresentacao"}.pptx`,
      bytes,
    };
}

/**
 * Builds a VISUAL slides PDF (landscape 16:9) that mirrors the branded PPTX in
 * the Gamma-style design system (no background images): a dark impact cover,
 * full-bleed colored module dividers, and light content slides with a left
 * accent rail, filled bullet markers and amber callout boxes. This is the PDF
 * the student downloads — NOT the running text. Only the structured "SLIDE N:"
 * format is supported; callers should fall back to the text renderer otherwise.
 */
export async function buildGenerationSlidesPDF(
  gen: { tool: string; title: string; result: unknown; prompt: unknown },
  userId: string,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const slidesMarkdown = normalizeAIContent(gen.result);
  if (!/^\s*SLIDE\s+\d+\s*:/m.test(slidesMarkdown)) return null;

  const W = 960;
  const H = 540;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const embedFromUrl = async (url: string | null | undefined) => {
    if (!url || typeof url !== "string") return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      return isPng ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
    } catch {
      return null;
    }
  };

  const logoUrl = await import("./branding.server")
    .then((m) => m.resolveBrandingLogoUrl(userId))
    .catch(() => null);
  const logoImg = await embedFromUrl(logoUrl);

  // Palette (hex → pdf-lib rgb), mirroring the PPTX design tokens.
  const hx = (h: string) =>
    rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  const promptObj: AnyObj =
    gen.prompt && typeof gen.prompt === "object" ? (gen.prompt as AnyObj) : {};
  const design = resolveSlideDesign(promptObj.color_theme, promptObj.template);
  const TEMPLATE: SlideTemplateKey = design.template;
  const ACCENTS = design.accents.map(hx);
  const COVER = hx(design.cover);
  const INK = hx("0F172A");
  const BODY = hx("334155");
  const LIGHT = hx(TEMPLATE === "classico" ? "FFFFFF" : "F8FAFC");
  const WHITE = rgb(1, 1, 1);
  const LIGHT_TXT = hx("CBD5E1");
  const CALLOUT_BG = hx("FEF3C7");
  const CALLOUT_TXT = hx("92400E");
  const DARK_TITLE = WHITE;
  const DARK_BODY = hx("E2E8F0");
  const DARK_CALLOUT_BG = hx("422006");
  const DARK_CALLOUT_TXT = hx("FDE68A");
  const isDark = TEMPLATE === "escuro";
  const lightCover = TEMPLATE === "classico" || TEMPLATE === "minimalista";
  const dividerFullBleed = TEMPLATE === "moderno" || TEMPLATE === "escuro";
  const leftRail = TEMPLATE === "moderno";

  const calloutRe = /^\s*(?:⚠️?|aten[çc][ãa]o|importante|nota|obs)\b[:.\-\s]*/i;

  type Run = { text: string; bold: boolean };
  const parseBold = (text: string): Run[] => {
    const clean = sanitizeWinAnsi(text);
    const runs: Run[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      if (m.index > last) runs.push({ text: clean.slice(last, m.index), bold: false });
      runs.push({ text: m[1], bold: true });
      last = m.index + m[0].length;
    }
    if (last < clean.length) runs.push({ text: clean.slice(last), bold: false });
    return runs.length ? runs : [{ text: clean, bold: false }];
  };

  type LineTok = { text: string; f: typeof font; w: number };
  const wrapRuns = (
    runs: Run[],
    width: number,
    size: number,
    regular: typeof font,
    boldF: typeof font,
  ): LineTok[][] => {
    const out: LineTok[][] = [];
    let cur: LineTok[] = [];
    let curW = 0;
    for (const r of runs) {
      const f = r.bold ? boldF : regular;
      for (const p of r.text.split(/(\s+)/)) {
        if (!p) continue;
        const w = f.widthOfTextAtSize(p, size);
        if (curW + w > width && cur.length) {
          out.push(cur);
          cur = [];
          curW = 0;
          if (/^\s+$/.test(p)) continue;
        }
        cur.push({ text: p, f, w });
        curW += w;
      }
    }
    if (cur.length) out.push(cur);
    return out;
  };

  const blocks = slidesMarkdown
    .split(/^\s*SLIDE\s+\d+\s*:\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);

  let moduleIdx = -1;
  let moduleNo = 0;
  for (const block of blocks) {
    let title = "";
    let kind = "";
    const bullets: string[] = [];
    const extras: string[] = [];
    let section: "main" | "extra" | "example" | null = null;
    let imageUrl: string | null = null;
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^Tipo de Slide\s*:\s*(.*)$/i))) { kind = m[1].trim(); section = null; continue; }
      if ((m = line.match(/^T[íi]tulo do Slide\s*:\s*(.*)$/i))) { title = m[1].trim(); section = null; continue; }
      if (/^Conte[úu]do Principal\s*:?\s*$/i.test(line)) { section = "main"; continue; }
      if (/^Detalhes Adicionais.*:?\s*$/i.test(line)) { section = "extra"; continue; }
      if (/^Sugest[ãa]o de Recurso Visual\s*:/i.test(line)) { section = null; continue; }
      if (/^Notas do Professor\s*:/i.test(line)) { section = null; continue; }
      // Extract image URL from slide content
      if ((m = line.match(/^Imagem:\s*(https?:\/\/[^\s]+)$/i))) { imageUrl = m[1].trim(); section = null; continue; }
      const bm = line.match(/^[-*•]\s+(.*)$/);
      const text = bm ? bm[1].trim() : line;
      if (section === "main") bullets.push(text);
      else if (section === "extra") extras.push(text);
      else if (bullets.length === 0 && !title) title = text;
    }

    const k = kind.toLowerCase();
    if (k.includes("módulo") || k.includes("modulo")) { moduleIdx++; moduleNo++; }
    const accent = ACCENTS[(moduleIdx < 0 ? 0 : moduleIdx) % ACCENTS.length];

    const page = pdf.addPage([W, H]);

    const drawLogo = (dark: boolean) => {
      if (!logoImg) return;
      const boxW = 118;
      const boxH = 44;
      const dims = logoImg.scale(1);
      const ratio = Math.min(boxW / dims.width, boxH / dims.height);
      const dw = dims.width * ratio;
      const dh = dims.height * ratio;
      const x = W - 26 - dw;
      const y = H - 22 - dh;
      if (dark) page.drawRectangle({ x: x - 8, y: y - 6, width: dw + 16, height: dh + 12, color: WHITE });
      page.drawImage(logoImg, { x, y, width: dw, height: dh });
    };

    const heading = title || kind || "Slide";
    const allBullets = [...bullets, ...extras];

    const drawLines = (
      lines: LineTok[][],
      x: number,
      top: number,
      width: number,
      size: number,
      align: "left" | "center",
      color = BODY,
      lineHeight = 1.32,
    ): number => {
      let y = top;
      for (const ln of lines) {
        const lineW = ln.reduce((a, t) => a + t.w, 0);
        let sx = align === "center" ? x + (width - lineW) / 2 : x;
        for (const t of ln) {
          page.drawText(t.text, { x: sx, y: y - size, size, font: t.f, color });
          sx += t.w;
        }
        y -= size * lineHeight;
      }
      return y;
    };

    if (k.includes("capa")) {
      // Impact cover (dark for moderno/escuro, light for classico/minimalista).
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: lightCover ? WHITE : COVER });
      drawLogo(!lightCover);
      page.drawRectangle({ x: 70, y: H - 250, width: 11, height: 120, color: accent });
      page.drawText(sanitizeWinAnsi("APRESENTAÇÃO DE AULA"), { x: 95, y: H - 132, size: 13, font: fontBold, color: accent });
      const tLines = wrapRuns(parseBold(heading), W - 180, 38, fontBold, fontBold);
      let y = drawLines(tLines, 95, H - 162, W - 180, 38, "left", lightCover ? INK : WHITE, 1.15);
      y -= 12;
      for (const b of allBullets) {
        const lines = wrapRuns(parseBold(b), W - 190, 17, font, fontBold);
        y = drawLines(lines, 95, y, W - 190, 17, "left", lightCover ? BODY : LIGHT_TXT, 1.4) - 4;
      }
    } else if (k.includes("módulo") || k.includes("modulo") || k.includes("aula")) {
      const label = k.includes("aula") ? "AULA" : `MÓDULO ${String(moduleNo).padStart(2, "0")}`;
      if (dividerFullBleed) {
        // Full-bleed colored section divider.
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: accent });
        drawLogo(true);
        const lLines = wrapRuns(parseBold(label), W - 160, 16, fontBold, fontBold);
        drawLines(lLines, 80, H / 2 + 72, W - 160, 16, "center", WHITE, 1.2);
        const tLines = wrapRuns(parseBold(heading), W - 160, 32, fontBold, fontBold);
        drawLines(tLines, 80, H / 2 + 34, W - 160, 32, "center", WHITE, 1.2);
        page.drawRectangle({ x: W / 2 - 40, y: H / 2 - 62, width: 80, height: 5, color: WHITE });
      } else if (TEMPLATE === "classico") {
        // Light divider with a bold left accent band.
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
        page.drawRectangle({ x: 0, y: 0, width: 40, height: H, color: accent });
        drawLogo(false);
        const lLines = wrapRuns(parseBold(label), W - 160, 16, fontBold, fontBold);
        drawLines(lLines, 80, H / 2 + 62, W - 160, 16, "left", accent, 1.2);
        const tLines = wrapRuns(parseBold(heading), W - 160, 32, fontBold, fontBold);
        drawLines(tLines, 80, H / 2 + 26, W - 160, 32, "left", INK, 1.2);
      } else {
        // Minimalista: white, centered, thin rule.
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
        drawLogo(false);
        const lLines = wrapRuns(parseBold(label), W - 160, 15, fontBold, fontBold);
        drawLines(lLines, 80, H / 2 + 66, W - 160, 15, "center", accent, 1.2);
        const tLines = wrapRuns(parseBold(heading), W - 160, 32, fontBold, fontBold);
        drawLines(tLines, 80, H / 2 + 30, W - 160, 32, "center", INK, 1.2);
        page.drawRectangle({ x: W / 2 - 30, y: H / 2 - 56, width: 60, height: 3, color: accent });
      }
    } else if (k.includes("encerr")) {
      const darkEncerr = !lightCover;
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: darkEncerr ? COVER : WHITE });
      drawLogo(darkEncerr);
      page.drawRectangle({ x: W / 2 - 40, y: H - 118, width: 80, height: 6, color: accent });
      const head = wrapRuns(parseBold("MENSAGEM DO PROFESSOR"), W - 160, 15, fontBold, fontBold);
      drawLines(head, 80, H - 132, W - 160, 15, "center", accent, 1.2);
      const msg = allBullets.filter((b) => !/^[—-]/.test(b)).join(" ");
      const sign = formatProfessorSignature(
        allBullets.filter((b) => /^[—-]/.test(b)).join("  "),
      );
      const mLines = wrapRuns(parseBold(msg), W - 220, 24, fontItalic, fontItalic);
      let y = drawLines(mLines, 110, H - 212, W - 220, 24, "center", darkEncerr ? WHITE : INK, 1.4);
      if (sign) {
        const sLines = wrapRuns(parseBold(sign), W - 220, 20, fontBold, fontBold);
        drawLines(sLines, 110, y - 24, W - 220, 20, "center", darkEncerr ? LIGHT_TXT : accent, 1.3);
      }
    } else {
      // Content slide.
      const bg = isDark ? COVER : LIGHT;
      const titleColor = isDark ? DARK_TITLE : INK;
      const bodyColor = isDark ? DARK_BODY : BODY;
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
      if (leftRail) page.drawRectangle({ x: 0, y: 0, width: 20, height: H, color: accent });
      drawLogo(isDark);
      const tx = leftRail ? 56 : 48;
      const tLines = wrapRuns(parseBold(heading), W - 200, 28, fontBold, fontBold);
      let y = drawLines(tLines, tx, H - 60, W - 200, 28, "left", titleColor, 1.15);
      page.drawRectangle({ x: tx + 2, y: y - 8, width: TEMPLATE === "minimalista" ? 44 : 64, height: TEMPLATE === "minimalista" ? 3 : 5, color: accent });
      y -= 32;

      const normal = allBullets.filter((b) => !calloutRe.test(b));
      const callouts = allBullets.filter((b) => calloutRe.test(b)).map((b) => b.replace(calloutRe, "").trim());

      const MARK = sanitizeWinAnsi(
        TEMPLATE === "minimalista" ? "\u2013" : TEMPLATE === "classico" ? "\u25cf" : "\u25aa",
      );
      const bx = leftRail ? 58 : 50;
      const pdfBodyItems = normal.slice(0, 8).map(emphasizeBulletLabel);

      // Add slide image if available (at bottom of content area)
      let imageHeight = 0;
      if (imageUrl) {
        const slideImg = await embedFromUrl(imageUrl);
        if (slideImg) {
          const imgW = 280;
          const ratio = imgW / Math.max(slideImg.width, 1);
          imageHeight = Math.min(slideImg.height * ratio, 150);
          const imgX = (W - imgW) / 2;
          page.drawImage(slideImg, { x: imgX, y: 20, width: imgW, height: imageHeight });
        }
      }

      // Dynamically shrink the body font so dense slides never overflow the page.
      const bottomMargin = callouts.length ? 140 : (imageUrl ? imageHeight + 60 : 46);
      const availH = y - bottomMargin;
      let bodySize = 20;
      for (const candidate of [20, 18, 17, 16, 15, 14, 13, 12, 11]) {
        let needed = 0;
        for (const b of pdfBodyItems) {
          const lines = wrapRuns(parseBold(b), W - (bx + 100), candidate, font, fontBold);
          needed += lines.length * candidate * 1.34 + 9;
        }
        bodySize = candidate;
        if (needed <= availH) break;
      }
      const markSize = Math.round(bodySize * 0.75);
      for (const b of pdfBodyItems) {
        const lines = wrapRuns(parseBold(b), W - (bx + 100), bodySize, font, fontBold);
        page.drawText(MARK, { x: bx, y: y - bodySize + 1, size: markSize, font: fontBold, color: accent });
        y = drawLines(lines, bx + 26, y, W - (bx + 100), bodySize, "left", bodyColor, 1.34) - 9;
      }

      if (callouts.length) {
        const boxH = 84;
        const boxY = imageUrl ? (20 + imageHeight + 20) : 34;
        page.drawRectangle({
          x: bx - 2, y: boxY, width: W - (bx - 2) - 54, height: boxH,
          color: isDark ? DARK_CALLOUT_BG : CALLOUT_BG, borderColor: accent, borderWidth: 2,
        });
        const cText = callouts.join("  ");
        const cRuns: Run[] = [{ text: "Atenção — ", bold: true }, ...parseBold(cText)];
        const cLines = wrapRuns(cRuns, W - (bx + 40), 15, fontBold, fontBold);
        drawLines(cLines.slice(0, 3), bx + 16, boxY + boxH - 16, W - (bx + 40), 15, "left", isDark ? DARK_CALLOUT_TXT : CALLOUT_TXT, 1.3);
      }
    }
  }

  const bytes = await pdf.save();
  return {
    filename: `${gen.title.replace(/[^\w\s-]/g, "").trim() || "apresentacao"}.pdf`,
    bytes,
  };
}

export const exportGenerationPPTX = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const gen = await loadGeneration(data.id, context.userId);
    const { filename, bytes } = await buildGenerationPPTX(gen, context.userId);
    return {
      filename,
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      base64: bufferToBase64(bytes),
    };
  });

export const exportGenerationDOCX = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const gen = await loadGeneration(data.id, context.userId);
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await import("docx");
    const logoUrl = gen.tool === "lesson_plan"
      ? await import("./branding.server").then((m) => m.resolveBrandingLogoUrl(context.userId)).catch(() => null)
      : null;
    const rawMarkdown = gen.tool === "lesson_plan"
      ? ensureLessonPlanStandardHeader(normalizeAIContent(gen.result), { fallbackTitle: gen.title, logoUrl })
      : normalizeAIContent(gen.result);
    const markdown = (gen.tool === "apostila"
      ? normalizeApostilaMarkdown(rawMarkdown)
      : rawMarkdown
    ).replace(/\r\n/g, "\n");
    const children: InstanceType<typeof Paragraph>[] = [];
    const textRunsFromMarkdown = (text: string) =>
      text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
        part.startsWith("**") && part.endsWith("**")
          ? new TextRun({ text: part.slice(2, -2), bold: true })
          : new TextRun(part),
      );
    const addParagraph = (text: string) => children.push(new Paragraph({ children: textRunsFromMarkdown(text) }));
    if (gen.tool !== "quiz" && gen.tool !== "lesson_plan") {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: gen.title, bold: true })] }));
    }
    for (const raw of markdown.split("\n")) {
      const line = raw.trim();
      if (!line) { children.push(new Paragraph({ text: "" })); continue; }
      const image = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
      if (image) {
        try {
          const res = await fetch(image[1]);
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            const isPng = buf[0] === 0x89 && buf[1] === 0x50;
            children.push(new Paragraph({
              children: [new ImageRun({
                type: isPng ? "png" : "jpg",
                data: buf,
                transformation: { width: 151, height: 76 },
              })],
            }));
          }
        } catch { /* skip logo on failure */ }
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) {
        children.push(new Paragraph({
          heading: h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: [new TextRun({ text: h[2].replace(/\*\*/g, ""), bold: true })],
        }));
      } else {
        addParagraph(line.replace(/^([-*+•])\s+/, "• "));
      }
    }
    const buf = await Packer.toBuffer(new Document({
      sections: [{
        properties: { page: { margin: { top: 850, right: 850, bottom: 850, left: 850 } } },
        children,
      }],
    }));
    const bytes = new Uint8Array(buf);
    return {
      filename: `${safeFileName(buildDocumentFilename(gen.title, markdown)) || "documento"}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64: bufferToBase64(bytes),
    };
  });