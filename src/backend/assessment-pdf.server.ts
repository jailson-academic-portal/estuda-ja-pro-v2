import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { stripHardcodedCorrectLetter } from "@/lib/text-sanitize";

/** Campo de data estático — preenchido manualmente à caneta na prova impressa. */
const STATIC_DATE_FIELD = "___/___/___";

/* ============================================================================
 * ANTI-OCR SECURITY FEATURES
 * ============================================================================ */

/**
 * Desenha marca d'água diagonal com o nome da disciplina.
 * - Todas as páginas recebem a marca d'água
 * - Fonte grande, cinza claro semi-transparente
 */
function drawWatermark(page: PDFPage, discipline: string, font: PDFFont, bold: PDFFont) {
  const watermarkText = discipline.toUpperCase();
  const size = 48;
  const opacity = 0.08; // Muito sutil, não atrapalha leitura

  // Calcula posição centralizada na diagonal
  const textWidth = bold.widthOfTextAtSize(watermarkText, size);

  // Posição centralizada
  const centerX = (PAGE_W - textWidth) / 2;
  const centerY = PAGE_H / 2 - size / 2;

  // Rotaciona o texto em 45 graus usando transform
  page.drawText(watermarkText, {
    x: centerX,
    y: centerY,
    size,
    font: bold,
    color: rgb(0.5, 0.5, 0.55),
    opacity,
  });
}

/**
 * Desenha padrão de fundo anti-OCR.
 * - Linhas diagonais finas muito suaves
 * - Dificulta reconhecimento por câmeras de celular
 * - NÃO afeta folhas de gabarito (identificadas por section.label)
 */
function drawAntiOCRPattern(page: PDFPage, isGabarito: boolean) {
  if (isGabarito) return; // Gabarito fica com fundo limpo para OCR

  const lineColor = rgb(0.92, 0.92, 0.94); // Linhas quase invisíveis
  const spacing = 18; // Espaçamento entre linhas diagonais
  const thickness = 0.3; // Linha muito fina

  // Desenha linhas diagonais em toda a página
  // Direção: diagonal ↘ (canto inferior esquerdo para superior direito)
  for (let y = -PAGE_H; y < PAGE_H + PAGE_W; y += spacing) {
    page.drawLine({
      start: { x: 0, y: y },
      end: { x: y + PAGE_H, y: PAGE_H },
      thickness,
      color: lineColor,
    });
  }

  // Adiciona pontilhado sutil por cima para dificultar mais
  const dotColor = rgb(0.88, 0.88, 0.9);
  for (let x = 20; x < PAGE_W; x += 25) {
    for (let y = 20; y < PAGE_H; y += 25) {
      page.drawCircle({
        x,
        y,
        size: 0.5,
        color: dotColor,
      });
    }
  }
}

type Question = {
  id: string;
  position: number;
  qtype: "multiple_choice" | "true_false" | "fill_blank" | "essay";
  prompt: string;
  options: string[] | null;
  weight: number;
  explanation?: string | null;
};

type Version = {
  id: string;
  version_label: string;
  question_order: string[];
  option_orders: Record<string, number[]>;
  answer_key?: Record<string, unknown>;
};

type Assignment = {
  id: string;
  student_id: string;
  student_name: string;
  enrollment_number?: string | null;
  version_id: string;
  copy_index: number;
  qr_token: string;
  question_order?: string[] | null;
  option_orders?: Record<string, number[]> | null;
  answer_key?: Record<string, unknown> | null;
};

type Header = {
  institution: string | null;
  discipline: string;
  teacher: string | null;
  title: string;
  module: string | null;
  max_score: number;
  date: string | null;
  diary_column: string | null;
};

/**
 * Modelo de cabeçalho institucional — usado APENAS nas avaliações (folha de
 * questões e folha de respostas). Quando ausente, o cabeçalho padrão é mantido.
 */
export type HeaderTemplate = {
  name?: string | null;
  logo_url?: string | null;
  logo_scale?: number | null;
  banner_color?: string | null;
  strip_color?: string | null;
  unit_label?: string | null;
  shift_label?: string | null;
  instructions?: string | null;
  show_grade_box?: boolean | null;
  compact_questions_header?: boolean | null;
  exclusive_answer_sheet_rules?: boolean | null;
};

function hexToRgb(hex: string | null | undefined, fallback: [number, number, number]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return rgb(fallback[0], fallback[1], fallback[2]);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_Y = 56;

/* ============================================================================
 * OMR LAYOUT — geometry captured during answer-sheet rendering so the
 * camera-based scanner can map detected pixels back to question/option ids.
 * All coordinates are PDF points with origin at the bottom-left corner.
 * ========================================================================== */
export type OMRBubble = { label: string; x: number; y: number; r: number };
export type OMRQuestion = {
  question_id: string;
  qtype: "multiple_choice" | "true_false" | "fill_blank" | "essay";
  bubbles: OMRBubble[];
};
export type OMRLayout = {
  page: { w: number; h: number };
  fiducials: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } };
  fiducial_size: number;
  questions: OMRQuestion[];
};

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text || "").split(/\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (cur) out.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

function safe(s: string): string {
  const greek: Record<string, string> = {
    "α":"alfa","β":"beta","γ":"gama","δ":"delta","ε":"epsilon","ζ":"zeta","η":"eta","θ":"teta",
    "ι":"iota","κ":"capa","λ":"lambda","μ":"mi","ν":"ni","ξ":"csi","ο":"omicron","π":"pi",
    "ρ":"ro","σ":"sigma","ς":"sigma","τ":"tau","υ":"upsilon","φ":"fi","χ":"qui","ψ":"psi","ω":"omega",
    "Α":"Alfa","Β":"Beta","Γ":"Gama","Δ":"Delta","Ε":"Epsilon","Ζ":"Zeta","Η":"Eta","Θ":"Teta",
    "Ι":"Iota","Κ":"Capa","Λ":"Lambda","Μ":"Mi","Ν":"Ni","Ξ":"Csi","Ο":"Omicron","Π":"Pi",
    "Ρ":"Ro","Σ":"Sigma","Τ":"Tau","Υ":"Upsilon","Φ":"Fi","Χ":"Qui","Ψ":"Psi","Ω":"Omega",
  };
  let out = String(s ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // Símbolos matemáticos comuns que o Helvetica (WinAnsi) não codifica —
    // substitui por equivalentes ASCII para evitar "?" no PDF.
    .replace(/\u2248/g, "~")           // ≈
    .replace(/\u2264/g, "<=")          // ≤
    .replace(/\u2265/g, ">=")          // ≥
    .replace(/\u2260/g, "!=")          // ≠
    .replace(/\u00B1/g, "+/-")         // ± (é Latin1 mas melhora legibilidade)
    .replace(/\u00D7/g, "x")           // ×
    .replace(/\u00F7/g, "/")           // ÷
    .replace(/\u2212/g, "-")           // −
    .replace(/\u00B7/g, ".")           // ·
    .replace(/\u2022/g, "-")           // •
    .replace(/\u2192/g, "->")          // →
    .replace(/\u2190/g, "<-")          // ←
    .replace(/\u2194/g, "<->")         // ↔
    .replace(/\u21D2/g, "=>")          // ⇒
    .replace(/\u221E/g, "inf")         // ∞
    .replace(/\u2206|\u0394/g, "Delta")// Δ (também tratado no bloco grego)
    .replace(/\u00B2/g, "^2")          // ²
    .replace(/\u00B3/g, "^3");         // ³
  out = out.replace(/[\u0370-\u03FF]/g, (c) => greek[c] ?? "");
  // Strip any remaining chars that WinAnsi (Helvetica) cannot encode.
  out = out.replace(/[^\u0000-\u00FF]/g, "?");
  return out;
}

// Remove markdown e prefixos de letra duplicados nas alternativas.
function cleanOption(s: string): string {
  let t = String(s ?? "").replace(/\*+/g, "").trim();
  t = t.replace(/^[\(\[]?\s*[A-Ea-e]\s*[\)\.\-:]\s+/, "");
  return t;
}

function cleanPrompt(s: string): string {
  let t = String(s ?? "").replace(/\*+/g, "");
  // Remove referências meta indesejadas nos enunciados (Aula X, apostila, módulo, "conforme/de acordo com...")
  t = t.replace(/,?\s*(conforme|de\s+acordo\s+com|segundo|como\s+(?:visto|mencionado|descrito|discutido|apresentado))\s+(o|a|na|no|nas|nos|os|as)?\s*(aula|apostila|m[óo]dulo|texto|material|conte[úu]do)[^.?!]*?(?=[.?!]|$)/giu, "");
  t = t.replace(/\(\s*(aula|apostila|m[óo]dulo)\s+[^)]*\)/giu, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([.,;:?!])/g, "$1");
  return t.trim();
}

function cleanExplanation(s: string): string {
  // Remove citação estática à letra correta ("A alternativa correta é a C.")
  // antes de qualquer outra limpeza — a letra muda por versão randomizada.
  const withoutLetter = stripHardcodedCorrectLetter(s);
  return cleanPrompt(withoutLetter)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Quebra listas de afirmativas/itens numerados (I., II., III., ...) em linhas
// separadas para melhorar a leitura — especialmente em blocos de Verdadeiro/Falso
// e Completar Lacunas, onde o primeiro item vinha "colado" ao enunciado.
function withItemBreaks(text: string): string {
  const romanRe = /(?:^|\s)(I{1,3}|IV|VI{0,3}|IX|X|V)\.(?=\s)/g;
  const count = (text.match(romanRe) || []).length;
  if (count < 3) return text;
  return text.replace(/\s+(?=(?:I{1,3}|IV|VI{0,3}|IX|X|V)\.\s)/g, "\n");
}

async function fetchLogoImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
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
}

type Ctx = {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  header: Header;
  controlNumber: string;
  sections: Array<{ pages: PDFPage[]; label: string; controlNumber: string }>;
  currentSection: { pages: PDFPage[]; label: string; controlNumber: string } | null;
  template?: HeaderTemplate | null;
  templateLogo?: PDFImage | null;
  student?: { name: string; enrollment: string | null } | null;
};

function startSection(ctx: Ctx, label: string) {
  ctx.currentSection = { pages: [], label, controlNumber: ctx.controlNumber };
  ctx.sections.push(ctx.currentSection);
}

/**
 * Cabeçalho institucional das AVALIAÇÕES, no modelo de folha impressa:
 * faixa colorida com a logo, tarja com disciplina/avaliação, quadro de
 * identificação (aluno, matrícula, unidade, turno, data, professor) e, na
 * primeira folha de cada seção, o quadro de "Atenção" com as orientações.
 * Retorna o Y disponível para o conteúdo.
 */
function drawTemplateHeader(
  ctx: Ctx,
  page: PDFPage,
  full: boolean,
  versionLabel?: string,
  badge?: string,
  suppressVersion?: boolean,
): number {
  const t = ctx.template!;
  const banner = hexToRgb(t.banner_color, [0.78, 0.83, 0]);
  const strip = hexToRgb(t.strip_color, [0.91, 0.2, 0.24]);
  const line = rgb(0.1, 0.1, 0.12);
  const logoScale = Math.min(2.5, Math.max(0.5, Number(t.logo_scale) || 1));

  const isQuestionsSheet = ctx.currentSection?.label.includes("Folhas de Questões");


  // REMOÇÃO INCONDICIONAL DO CABEÇALHO NAS PÁGINAS DE QUESTÕES
  if (isQuestionsSheet) {
    const displayDate = STATIC_DATE_FIELD;
    const disc = ctx.header.discipline.toUpperCase();
    const prof = (ctx.header.teacher || "________________").toUpperCase();
    const mod = (ctx.header.module || ctx.header.title || "").toUpperCase();

    if (full) {
      // PÁGINA 1: Cabeçalho institucional compacto (Disciplina, Professor, Módulo, Data, Aluno)
      const line1 = safe(`DISCIPLINA: ${disc}  |  PROFESSOR(A): ${prof}`);
      const line2 = safe(`MÓDULO: ${mod}`);
      const line3 = safe(`ALUNO: ${ctx.student?.name || "____________________"}  |  MATRÍCULA: ${ctx.student?.enrollment || "________"}  |  DATA: ${displayDate}`);

      page.drawText(line1, { x: MARGIN_X, y: PAGE_H - 24, size: 9, font: ctx.bold });
      page.drawText(line2, { x: MARGIN_X, y: PAGE_H - 36, size: 8.5, font: ctx.font });
      page.drawText(line3, { x: MARGIN_X, y: PAGE_H - 48, size: 9, font: ctx.bold });

      page.drawLine({
        start: { x: MARGIN_X, y: PAGE_H - 54 },
        end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 54 },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
      });
      return PAGE_H - 64;
    } else {
      // PÁGINA 2+: Cabeçalho simplificado de continuação (1 linha)
      const studentInfo = safe(
        `Aluno: ${ctx.student?.name || "____________________"}  |  Matrícula: ${ctx.student?.enrollment || "________"}  |  ${disc}`,
      );

      page.drawText(studentInfo, {
        x: MARGIN_X,
        y: PAGE_H - 26,
        size: 8.5,
        font: ctx.bold,
        color: rgb(0, 0, 0),
      });

      page.drawLine({
        start: { x: MARGIN_X, y: PAGE_H - 30 },
        end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 30 },
        thickness: 0.8,
        color: rgb(0.8, 0.8, 0.8),
      });
      return PAGE_H - 40;
    }
  }


  // Cabeçalho completo apenas para Folha de Respostas e Gabarito
  const bannerH = (full ? 74 : 48) * Math.max(1, logoScale);
  page.drawRectangle({ x: 0, y: PAGE_H - bannerH, width: PAGE_W, height: bannerH, color: banner });
  const logo = ctx.templateLogo ?? ctx.logo;
  if (logo) {
    const maxH = bannerH - 14;
    const maxW = Math.min(PAGE_W - MARGIN_X * 2, 190 * logoScale);
    const dims = logo.scale(1);
    const ratio = Math.min(maxW / dims.width, maxH / dims.height);
    const lw = dims.width * ratio;
    const lh = dims.height * ratio;
    page.drawImage(logo, {
      x: PAGE_W - MARGIN_X - lw,
      y: PAGE_H - bannerH + (bannerH - lh) / 2,
      width: lw,
      height: lh,
    });
  }

  const moduleLabel = (() => {
    const raw = String(t ? ctx.header.module ?? "" : "").trim();
    if (raw) return raw;
    return String(ctx.header.title ?? "")
      .replace(/^\s*avalia[çc][ãa]o\s*[:\-–—]?\s*/i, "")
      .replace(/^[\s:\-–—]+/, "")
      .trim();
  })();

  const discText = safe(`DISCIPLINA: ${ctx.header.discipline.toUpperCase()}`);
  const evalText = safe(`AVALIAÇÃO: ${moduleLabel.toUpperCase() || "GERAL"}`);

  const stripH = 34;
  const stripY = PAGE_H - bannerH - stripH;
  page.drawRectangle({ x: 0, y: stripY, width: PAGE_W, height: stripH, color: strip });

  const stripMaxW = PAGE_W - MARGIN_X * 2;
  const drawCenteredLine = (text: string, size: number, yOffset: number) => {
    let s = size;
    while (s > 7 && ctx.bold.widthOfTextAtSize(text, s) > stripMaxW) s -= 0.5;
    page.drawText(text, {
      x: (PAGE_W - ctx.bold.widthOfTextAtSize(text, s)) / 2,
      y: stripY + yOffset,
      size: s,
      font: ctx.bold,
      color: rgb(1, 1, 1),
    });
  };

  drawCenteredLine(discText, 11, 19);
  drawCenteredLine(evalText, 11, 6);

  let y = stripY;
  const left = MARGIN_X;
  const right = PAGE_W - MARGIN_X;
  const tableW = right - left;

  const cell = (x: number, w: number, top: number, h: number, label: string, value: string) => {
    page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: line, borderWidth: 0.8 });
    const text = safe(value ? `${label}: ${value}` : `${label}:`);
    let size = 10;
    while (size > 6.5 && ctx.font.widthOfTextAtSize(text, size) > w - 10) size -= 0.5;
    page.drawText(text, { x: x + 5, y: top - h + (h - size) / 2 + 1, size, font: ctx.font, color: rgb(0, 0, 0) });
  };

  if (full) {
    const rowH = 21;
    const w1 = tableW * 0.68;
    cell(left, w1, y, rowH, "Aluno", ctx.student?.name ?? "");
    cell(left + w1, tableW - w1, y, rowH, "Matrícula", ctx.student?.enrollment ?? "");
    y -= rowH;
    const ws = [tableW * 0.25, tableW * 0.17, tableW * 0.25];
    ws.push(tableW - ws[0] - ws[1] - ws[2]);
    const vals: Array<[string, string]> = [
      ["Unidade", t.unit_label ?? ""],
      ["Turno", t.shift_label ?? ""],
      ["Data", STATIC_DATE_FIELD],
      ["Professor", (ctx.header.teacher ?? "").toUpperCase()],
    ];
    let cx = left;
    vals.forEach(([label, value], i) => {
      cell(cx, ws[i], y, rowH, label, value);
      cx += ws[i];
    });
    y -= rowH;

    const instructions = String(t.instructions ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (instructions.length > 0) {
      const showBox = t.show_grade_box !== false;
      const boxW = showBox ? 92 : 0;
      const textMaxW = tableW - 16 - (showBox ? boxW + 12 : 0);
      const size = 8.5;
      const lines: string[] = [];
      for (const item of instructions) {
        for (const l of wrap(safe(item), ctx.font, size, textMaxW)) lines.push(l);
      }
      const boxH = Math.max(showBox ? 74 : 0, 16 + 12 + lines.length * (size + 2.5) + 6);
      const boxTop = y;

      page.drawRectangle({
        x: left,
        y: boxTop - boxH,
        width: tableW,
        height: boxH,
        color: rgb(0.87, 0.96, 0.96),
        borderColor: line,
        borderWidth: 0.8,
      });
      page.drawText(safe("Atenção"), { x: left + 8, y: boxTop - 14, size: 9.5, font: ctx.bold, color: rgb(0, 0, 0) });
      let ty = boxTop - 26;
      for (const l of lines) {
        page.drawText(l, { x: left + 8, y: ty, size, font: ctx.font, color: rgb(0.1, 0.1, 0.15) });
        ty -= size + 2.5;
      }
      if (showBox) {
        page.drawRectangle({
          x: right - boxW - 8,
          y: boxTop - boxH + 8,
          width: boxW,
          height: Math.min(boxH - 16, 66),
          color: rgb(1, 1, 1),
          borderColor: line,
          borderWidth: 0.8,
        });
        page.drawText(safe("Nota"), {
          x: right - boxW - 2,
          y: boxTop - 20,
          size: 8,
          font: ctx.bold,
          color: rgb(0.3, 0.3, 0.35),
        });
      }
      y = boxTop - boxH;
    }
  }

  const metaParts: string[] = [`Nº ${ctx.controlNumber}`];
  if (!suppressVersion && versionLabel) metaParts.push(`Versão ${versionLabel}`);
  if (badge) metaParts.push(badge);
  if (typeof ctx.header.max_score === "number") {
    metaParts.push(`Nota máx.: ${Number(ctx.header.max_score).toFixed(2).replace(".", ",")}`);
  }
  const meta = safe(metaParts.join("   ·   "));
  page.drawText(meta, {
    x: right - ctx.font.widthOfTextAtSize(meta, 7.5),
    y: y - 10,
    size: 7.5,
    font: ctx.font,
    color: rgb(0.45, 0.45, 0.5),
  });

  return y - 20;

}

function newPage(ctx: Ctx, versionLabel?: string, badge?: string, suppressVersion?: boolean): { page: PDFPage; y: number } {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  const isFirstOfSection = !ctx.currentSection || ctx.currentSection.pages.length === 0;
  if (ctx.currentSection) ctx.currentSection.pages.push(page);

  // Adiciona marca d'água com o nome da disciplina em todas as páginas
  drawWatermark(page, ctx.header.discipline, ctx.font, ctx.bold);

  // Verifica se é página de questões para adicionar anti-OCR
  // Gabarito e folha de respostas NÃO têm anti-OCR (precisam de fundo limpo para OCR)
  const isQuestionsSection = ctx.currentSection?.label?.includes("Folha de Questões") ?? false;
  if (isQuestionsSection) {
    drawAntiOCRPattern(page, false); // false = TEM anti-OCR
  }

  if (ctx.template) {
    return {
      page,
      y: drawTemplateHeader(ctx, page, isFirstOfSection, versionLabel, badge, suppressVersion),
    };
  }

  const topY = PAGE_H - MARGIN_Y;
  const headerLeft = MARGIN_X;
  let textX = MARGIN_X;
  let logoBottom = topY;

  // Calcula as dimensões da logo, mas só a desenha DEPOIS dos textos, para
  // poder centralizá-la verticalmente na altura do bloco de textos (fica um
  // pouco mais abaixo, alinhada ao centro do cabeçalho).
  let logoW = 0;
  let logoH = 0;
  if (ctx.logo) {
    const maxH = 72;
    const maxW = 92;
    const dims = ctx.logo.scale(1);
    const ratio = Math.min(maxW / dims.width, maxH / dims.height);
    logoW = dims.width * ratio;
    logoH = dims.height * ratio;
    textX = headerLeft + logoW + 10;
  }

  const textMaxW = PAGE_W - MARGIN_X - textX;
  let lineY = topY;

  // O nome da instituição não é mais impresso no cabeçalho: a logo institucional
  // já contém o nome, evitando duplicidade.
  const disciplineLine = `${ctx.header.discipline.toUpperCase()}${ctx.header.teacher ? ` – Prof(a). ${ctx.header.teacher}` : ""}`;
  for (const line of wrap(safe(disciplineLine), ctx.bold, 11, textMaxW)) {
    page.drawText(line, { x: textX, y: lineY - 11, size: 11, font: ctx.bold, color: rgb(0, 0, 0) });
    lineY -= 13;
  }

  let cleanTitle = String(ctx.header.title ?? "")
    .replace(/^\s*avalia[çc][ãa]o\s*[:\-–—]?\s*/i, "")
    .replace(/^[\s:\-–—]+/, "")
    .trim();
  // "Módulo N: Nome" -> "Módulo N - Nome"
  cleanTitle = cleanTitle.replace(/^(m[óo]dulo\s+\d+)\s*[:\-–—]\s*/i, "$1 - ");
  const avalLine = `Avaliação: ${cleanTitle || ctx.header.title}`;
  for (const line of wrap(safe(avalLine), ctx.font, 10, textMaxW)) {
    page.drawText(line, { x: textX, y: lineY - 10, size: 10, font: ctx.font, color: rgb(0.15, 0.15, 0.2) });
    lineY -= 12;
  }

  const metaParts: string[] = [];
  metaParts.push(`Nº ${ctx.controlNumber}`);
  metaParts.push(`Data: ${STATIC_DATE_FIELD}`);
  // O vínculo com o diário é interno ao corretor/lançamento de notas; não deve aparecer na prova do aluno.
  if (!suppressVersion && versionLabel) metaParts.push(`Versão ${versionLabel}`);
  if (badge) metaParts.push(badge);
  if (typeof ctx.header.max_score === "number") {
    metaParts.push(`Nota máx.: ${Number(ctx.header.max_score).toFixed(2).replace(".", ",")}`);
  }
  for (const line of wrap(safe(metaParts.join("   ·   ")), ctx.font, 8.5, textMaxW)) {
    page.drawText(line, { x: textX, y: lineY - 9, size: 8.5, font: ctx.font, color: rgb(0.35, 0.35, 0.4) });
    lineY -= 11;
  }

  // Desenha a logo centralizada verticalmente em relação ao bloco de textos.
  if (ctx.logo) {
    const logoY = (topY + lineY) / 2 - logoH / 2;
    page.drawImage(ctx.logo, { x: headerLeft, y: logoY, width: logoW, height: logoH });
    logoBottom = logoY;
  }

  const headerBottom = Math.min(lineY, logoBottom) - 6;
  const y = headerBottom;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: PAGE_W - MARGIN_X, y },
    thickness: 0.6,
    color: rgb(0.7, 0.7, 0.75),
  });
  return { page, y: y - 12 };
}

function ensureSpace(
  ctx: Ctx,
  ref: { page: PDFPage; y: number },
  needed: number,
  versionLabel: string,
  badge?: string,
  suppressVersion?: boolean,
) {
  if (ref.y - needed < MARGIN_Y) {
    const np = newPage(ctx, versionLabel, badge, suppressVersion);
    ref.page = np.page;
    ref.y = np.y;
  }
}

function drawWrapped(
  ref: { page: PDFPage; y: number },
  ctx: Ctx,
  text: string,
  opts: {
    size: number;
    bold?: boolean;
    indent?: number;
    maxW?: number;
    versionLabel: string;
    badge?: string;
    color?: ReturnType<typeof rgb>;
    suppressVersion?: boolean;
  },
) {
  const font = opts.bold ? ctx.bold : ctx.font;
  const indent = opts.indent ?? 0;
  const maxW = (opts.maxW ?? PAGE_W - MARGIN_X * 2) - indent;
  const lh = opts.size + 4;
  for (const line of wrap(safe(text), font, opts.size, maxW)) {
    ensureSpace(ctx, ref, lh, opts.versionLabel, opts.badge, opts.suppressVersion);
    ref.page.drawText(line, {
      x: MARGIN_X + indent,
      y: ref.y - opts.size,
      size: opts.size,
      font,
      color: opts.color ?? rgb(0, 0, 0),
    });
    ref.y -= lh;
  }
}

function drawQuestionsPages(
  ctx: Ctx,
  version: Version,
  questions: Question[],
  layout: "one_column" | "two_columns" | "mixed" = "one_column",
): void {
  startSection(ctx, `Folhas de Questões — Versão ${version.version_label}`);

  // Adiciona padrão anti-OCR nas páginas de questões (identificadas pela seção)
  // O padrão será adicionado em cada chunk de páginas

  const orderedIds = version.question_order.length ? version.question_order : questions.map((q) => q.id);
  const colGap = 16;
  const colWidth = (PAGE_W - MARGIN_X * 2 - colGap) / 2;
  const BOTTOM = 34;

  const sizeTitle = 10;
  const sizeOptions = 9;
  const lineHeight = 1.15;
  const optLineHeight = 1.15;

  const measureQuestion = (q: Question, displayPos: number, width: number): number => {
    let h = 0;
    const headLabel = `${displayPos}. (${(q.weight ?? 0).toFixed(2).replace(".", ",")} pt) `;
    const headerLines = wrap(safe(withItemBreaks(headLabel + cleanPrompt(q.prompt))), ctx.bold, sizeTitle, width);
    h += headerLines.length * (sizeTitle * lineHeight);
    
    if (q.qtype === "multiple_choice" && Array.isArray(q.options)) {
      const order = version.option_orders[q.id] ?? q.options.map((_, i) => i);
      const letters = "ABCDE";
      h += 1.5;
      order.forEach((origIdx, i) => {
        const text = `${letters[i]}) ${cleanOption(q.options![origIdx] ?? "")}`;
        const lines = wrap(safe(text), ctx.font, sizeOptions, width - 12);
        h += lines.length * (sizeOptions * optLineHeight) + 1;
      });
    } else if (q.qtype === "true_false" || q.qtype === "fill_blank") {
      h += 2 + sizeOptions * optLineHeight + 1;
    } else {
      h += 2 + 5 * 11;
    }
    return h + 8;
  };

  const renderQuestion = (
    page: PDFPage,
    q: Question,
    displayPos: number,
    x: number,
    yTop: number,
    width: number,
  ): void => {
    let y = yTop;
    const headLabel = `${displayPos}. (${(q.weight ?? 0).toFixed(2).replace(".", ",")} pt) `;
    const headerLines = wrap(safe(withItemBreaks(headLabel + cleanPrompt(q.prompt))), ctx.bold, sizeTitle, width);
    for (const line of headerLines) {
      page.drawText(line, { 
        x, 
        y: y - sizeTitle, 
        size: sizeTitle, 
        font: ctx.bold, 
        color: rgb(0, 0, 0),
        lineHeight: sizeTitle * lineHeight 
      });
      y -= sizeTitle * lineHeight;
    }
    y -= 1.5;
    if (q.qtype === "multiple_choice" && Array.isArray(q.options)) {
      const order = version.option_orders[q.id] ?? q.options.map((_, i) => i);
      const letters = "ABCDE";
      order.forEach((origIdx, i) => {
        const text = `${letters[i]}) ${cleanOption(q.options![origIdx] ?? "")}`;
        const lines = wrap(safe(text), ctx.font, sizeOptions, width - 12);
        for (const line of lines) {
          page.drawText(line, { x: x + 10, y: y - sizeOptions, size: sizeOptions, font: ctx.font, color: rgb(0, 0, 0) });
          y -= sizeOptions * optLineHeight;
        }
        y -= 1;
      });
    } else if (q.qtype === "true_false") {
      page.drawText("(   ) Verdadeiro       (   ) Falso", { x: x + 10, y: y - sizeOptions, size: sizeOptions, font: ctx.font });
    } else if (q.qtype === "fill_blank") {
      page.drawText("Resposta: ____________________________________________", { x: x + 10, y: y - sizeOptions, size: sizeOptions, font: ctx.font });
    } else {
      for (let i = 0; i < 5; i++) {
        page.drawLine({
          start: { x: x + 4, y: y - 4 },
          end: { x: x + width, y: y - 4 },
          thickness: 0.4,
          color: rgb(0.65, 0.65, 0.7),
        });
        y -= 11;
      }
    }
  };

  const allQuestions = orderedIds
    .map((qid) => questions.find((q) => q.id === qid))
    .filter((q): q is Question => !!q);

  // Split into chunks of 5 questions to force page breaks exactly as requested.
  const chunks: Question[][] = [];
  for (let i = 0; i < allQuestions.length; i += 5) {
    chunks.push(allQuestions.slice(i, i + 5));
  }

  chunks.forEach((chunk, chunkIdx) => {
    // newPage returns { page, y }. 'full' header (Institutional) is for page 1.
    // 'suppressVersion: true' because drawTemplateHeader handles it via versionLabel.
    // newPage também adiciona automaticamente a marca d'água e anti-OCR para folhas de questões.
    const ref = newPage(ctx, version.version_label, undefined, chunkIdx === 0);
    const topY = ref.y;
    let colIndex = 0;
    let cursorY = topY;

    chunk.forEach((q, qIdxInChunk) => {
      const globalIdx = chunkIdx * 5 + qIdxInChunk;
      const h = measureQuestion(q, globalIdx + 1, colWidth);

      // If Q overflows col 0, move to col 1.
      // If it still overflows col 1, we let it spill (but difficulty/length constraints should prevent this).
      if (colIndex === 0 && cursorY - h < BOTTOM) {
        colIndex = 1;
        cursorY = topY;
      }

      const x = MARGIN_X + colIndex * (colWidth + colGap);
      renderQuestion(ref.page, q, globalIdx + 1, x, cursorY, colWidth);
      cursorY -= h;
    });
  });
}

function drawAnswerKeyPages(ctx: Ctx, version: Version, questions: Question[]): void {
  const badge = "GABARITO DO PROFESSOR";
  const sectionTitle = (version as Version & { _student_name?: string })._student_name
    ? `Gabarito do Professor — ${(version as Version & { _student_name?: string })._student_name} (Versão ${version.version_label})`
    : `Gabarito do Professor — Versão ${version.version_label}`;
  startSection(ctx, sectionTitle);
  const ref = newPage(ctx, version.version_label, badge);
  const studentName = (version as Version & { _student_name?: string })._student_name;
  if (studentName) {
    drawWrapped(ref, ctx, `Folha personalizada de: ${studentName}`, {
      size: 10, bold: true, versionLabel: version.version_label, badge, color: rgb(0.1, 0.1, 0.15),
    });
  }
  drawWrapped(ref, ctx, "Documento de uso exclusivo do(a) professor(a). Não distribuir aos alunos.", {
    size: 9, versionLabel: version.version_label, badge, color: rgb(0.55, 0.1, 0.1),
  });
  if (ctx.header.diary_column) {
    drawWrapped(ref, ctx, `Coluna do diário para lançamento: ${ctx.header.diary_column}`, {
      size: 9.5, bold: true, versionLabel: version.version_label, badge,
    });
  }
  ref.y -= 6;

  const orderedIds = version.question_order.length ? version.question_order : questions.map((q) => q.id);
  const letters = "ABCDE";
  let displayPos = 1;
  for (const qid of orderedIds) {
    const q = questions.find((x) => x.id === qid);
    if (!q) continue;
    ensureSpace(ctx, ref, 40, version.version_label, badge);
    const typeLabel =
      q.qtype === "multiple_choice" ? "Múltipla escolha" :
      q.qtype === "true_false" ? "Verdadeiro/Falso" :
      q.qtype === "fill_blank" ? "Lacunas" : "Dissertativa";
    const head = `${displayPos}. [${typeLabel}]  (peso ${(q.weight ?? 0).toFixed(2).replace(".", ",")} pt)`;
    drawWrapped(ref, ctx, head, { size: 10.5, bold: true, versionLabel: version.version_label, badge });
    drawWrapped(ref, ctx, cleanPrompt(q.prompt), { size: 10, indent: 6, versionLabel: version.version_label, badge });

    const ak = (version.answer_key ?? {}) as Record<string, unknown>;
    const correct = ak[q.id];
    if (q.qtype === "multiple_choice" && Array.isArray(q.options)) {
      const order = version.option_orders[q.id] ?? q.options.map((_, i) => i);
      const letter = typeof correct === "string" ? correct : "";
      drawWrapped(ref, ctx, "Alternativas:", { size: 9, bold: true, indent: 14, versionLabel: version.version_label, badge, color: rgb(0.3, 0.3, 0.35) });
      for (const [i, origIdx] of order.entries()) {
        drawWrapped(ref, ctx, `${letters[i]}) ${cleanOption(q.options![origIdx] ?? "")}`, { size: 9, indent: 22, versionLabel: version.version_label, badge, color: rgb(0.3, 0.3, 0.35) });
        ref.y -= 1.5;
      }
      ref.y -= 1;
      drawWrapped(ref, ctx, `Resposta correta: ${letter || "—"}`, { size: 10.5, bold: true, indent: 14, versionLabel: version.version_label, badge, color: rgb(0.05, 0.4, 0.1) });
    } else if (q.qtype === "true_false") {
      const v = typeof correct === "boolean" ? correct : String(correct).toLowerCase().startsWith("v") || String(correct).toLowerCase() === "true";
      drawWrapped(ref, ctx, `Resposta correta: ${v ? "Verdadeiro" : "Falso"}`, { size: 10.5, bold: true, indent: 14, versionLabel: version.version_label, badge, color: rgb(0.05, 0.4, 0.1) });
    } else if (q.qtype === "fill_blank") {
      const arr = Array.isArray(correct) ? correct : [correct];
      drawWrapped(ref, ctx, `Resposta(s) esperada(s): ${arr.map((x) => String(x ?? "")).join("  |  ")}`, { size: 10.5, bold: true, indent: 14, versionLabel: version.version_label, badge, color: rgb(0.05, 0.4, 0.1) });
    } else {
      drawWrapped(ref, ctx, "Resposta dissertativa — ver gabarito comentado abaixo:", { size: 10, bold: true, indent: 14, versionLabel: version.version_label, badge });
    }

    if (q.explanation) {
      drawWrapped(ref, ctx, `Gabarito comentado: ${cleanExplanation(q.explanation)}`, {
        size: 9.5, indent: 14, versionLabel: version.version_label, badge, color: rgb(0.2, 0.2, 0.3),
      });
    }
    ref.y -= 6;
    displayPos++;
  }
}

async function drawAnswerSheet(ctx: Ctx, assignment: Assignment, version: Version, questions: Question[]): Promise<OMRLayout> {
  const studentLabel = assignment.student_name && assignment.student_name.trim().length > 0
    ? assignment.student_name
    : "________________________________";
  startSection(ctx, `Folha de Respostas — ${studentLabel}`);
  const ref = newPage(ctx, version.version_label, undefined, true);

  // Header card with isolated QR area: keeps professor/discipline/student data readable.
  const qrDataUrl = await QRCode.toDataURL(assignment.qr_token, { margin: 0, width: 240 });
  const qrBytes = Uint8Array.from(atob(qrDataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  const qrImg = await ctx.pdf.embedPng(qrBytes);
  const qrSize = 68;
  const cardTop = ref.y;
  const cardH = 124;
  const cardY = cardTop - cardH;
  const cardW = PAGE_W - MARGIN_X * 2;
  const qrBox = 92;
  const qrBoxX = PAGE_W - MARGIN_X - qrBox - 10;
  const qrBoxY = cardY + 18;
  const qrX = qrBoxX + (qrBox - qrSize) / 2;
  const qrY = qrBoxY + 18;
  const infoX = MARGIN_X + 14;
  const infoMaxW = qrBoxX - infoX - 16;

  ref.page.drawRectangle({ x: MARGIN_X, y: cardY, width: cardW, height: cardH, color: rgb(1, 1, 1), borderColor: rgb(0.72, 0.72, 0.78), borderWidth: 0.8 });
  ref.page.drawRectangle({ x: MARGIN_X, y: cardTop - 22, width: cardW, height: 22, color: rgb(0.94, 0.94, 0.97) });
  ref.page.drawText(safe("FOLHA DE RESPOSTAS"), { x: infoX, y: cardTop - 15, size: 12, font: ctx.bold, color: rgb(0, 0, 0) });

  let infoY = cardTop - 38;
  const infoRows = [
    { label: "Aluno(a)", value: studentLabel, bold: true, size: 10.5 },
    { label: "Matrícula", value: assignment.enrollment_number ?? "________________", bold: false, size: 9.5 },
    { label: "Disciplina", value: ctx.header.discipline, bold: false, size: 9.5 },
    { label: "Professor(a)", value: ctx.header.teacher ?? "—", bold: false, size: 9.5 },
  ];
  for (const row of infoRows) {
    const text = `${row.label}: ${row.value}`;
    for (const line of wrap(safe(text), row.bold ? ctx.bold : ctx.font, row.size, infoMaxW)) {
      ref.page.drawText(line, { x: infoX, y: infoY, size: row.size, font: row.bold ? ctx.bold : ctx.font, color: rgb(0.08, 0.08, 0.12) });
      infoY -= row.size + 3;
    }
  }

  ref.page.drawRectangle({ x: qrBoxX, y: qrBoxY, width: qrBox, height: qrBox, color: rgb(1, 1, 1), borderColor: rgb(0.7, 0.7, 0.76), borderWidth: 0.7 });
  ref.page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  ref.page.drawText(safe("QR da folha"), { x: qrBoxX + 25, y: qrBoxY + 7, size: 7.5, font: ctx.font, color: rgb(0.35, 0.35, 0.42) });

  // Instrução fica FORA do quadro de dados/QR Code (logo abaixo do card).
  const instruction = "Preencha COMPLETAMENTE com caneta preta ou azul apenas um círculo por questão no bloco de gabarito abaixo. Marcações duplas serão revisadas pelo professor.";
  let instructionY = cardY - 14;
  for (const line of wrap(safe(instruction), ctx.font, 8.5, cardW)) {
    ref.page.drawText(line, { x: MARGIN_X, y: instructionY, size: 8.5, font: ctx.font, color: rgb(0.34, 0.34, 0.4) });
    instructionY -= 10;
  }

  const omrQuestions: OMRQuestion[] = [];
  // Desce o gabarito e marcadores para baixo da instrução, com folga.
  ref.y = instructionY - 18;

  const orderedIds = version.question_order.length ? version.question_order : questions.map((q) => q.id);
  const letters = "ABCDE";

  // Build a display-position map (1..N) shared with the questions sheet.
  const posByQid = new Map<string, number>();
  orderedIds.forEach((qid, idx) => posByQid.set(qid, idx + 1));

  // Split into objective (OMR-eligible) and the rest.
  type Slot = { qid: string; qtype: Question["qtype"]; pos: number; nBubbles: number; labels: string[] };
  const objectiveSlots: Slot[] = [];
  const otherSlots: { qid: string; qtype: Question["qtype"]; pos: number }[] = [];
  for (const qid of orderedIds) {
    const q = questions.find((x) => x.id === qid);
    if (!q) continue;
    const pos = posByQid.get(qid)!;
    if (q.qtype === "multiple_choice") {
      const n = Math.min(5, Math.max(2, q.options?.length ?? 5));
      objectiveSlots.push({ qid: q.id, qtype: q.qtype, pos, nBubbles: n, labels: letters.slice(0, n).split("") });
    } else if (q.qtype === "true_false") {
      objectiveSlots.push({ qid: q.id, qtype: q.qtype, pos, nBubbles: 2, labels: ["V", "F"] });
    } else {
      otherSlots.push({ qid: q.id, qtype: q.qtype, pos });
    }
  }

  // ---- Centered OMR ANSWER BLOCK (Gradepen-style) ----------------------------
  // Geometry: two columns of questions, each row = "NN. ⓐ ⓑ ⓒ ⓓ ⓔ".
  const FID_SIZE = 14;          // black corner-square side
  const FID_GAP = 6;            // white halo around each fiducial
  const BLOCK_PAD_X = 18;       // inner horizontal padding
  const BLOCK_PAD_TOP = 22;     // inner top padding (title area inside block)
  const BLOCK_PAD_BOT = 14;
  const BUBBLE_R = 6.5;
  const BUBBLE_GAP = 22;        // center-to-center distance between bubbles
  const ROW_H = 22;
  const COL_GAP = 30;
  const NUM_COL_W = 26;         // width reserved for "NN." label
  // A 5-bubble row width:
  const ROW_BUBBLES_W = (5 - 1) * BUBBLE_GAP + BUBBLE_R * 2;
  const COL_W = NUM_COL_W + ROW_BUBBLES_W + 8;
  const N_COLS = objectiveSlots.length > 14 ? 2 : 1;
  const BLOCK_W = N_COLS === 2
    ? COL_W * 2 + COL_GAP + BLOCK_PAD_X * 2
    : COL_W + BLOCK_PAD_X * 2;
  const rowsPerCol = N_COLS === 2
    ? Math.ceil(objectiveSlots.length / 2)
    : objectiveSlots.length;
  const BLOCK_H = BLOCK_PAD_TOP + rowsPerCol * ROW_H + BLOCK_PAD_BOT;

  // Center horizontally; place just below current ref.y.
  const blockX = (PAGE_W - BLOCK_W) / 2;
  const blockYTop = ref.y - 4;
  const blockYBot = blockYTop - BLOCK_H;

  // If the block doesn't fit on this page, start a fresh page first.
  if (blockYBot < MARGIN_Y + 24) {
    const np = newPage(ctx, version.version_label, undefined, true);
    ref.page = np.page;
    ref.y = np.y;
  }
  const bx = blockX;
  const byTop = ref.y - 4;
  const byBot = byTop - BLOCK_H;

  // Block frame
  ref.page.drawRectangle({
    x: bx, y: byBot, width: BLOCK_W, height: BLOCK_H,
    borderColor: rgb(0.2, 0.2, 0.25), borderWidth: 0.8, color: rgb(1, 1, 1),
  });

  // "GABARITO" header strip inside the block
  ref.page.drawRectangle({
    x: bx, y: byTop - 18, width: BLOCK_W, height: 18, color: rgb(0.95, 0.95, 0.97),
  });
  ref.page.drawText(safe("GABARITO"), {
    x: bx + BLOCK_PAD_X, y: byTop - 13, size: 9.5, font: ctx.bold, color: rgb(0.2, 0.2, 0.25),
  });

  // 4 black fiducials around the block (these are what the OMR scanner uses).
  const fidPositions = {
    tl: { x: bx - FID_GAP - FID_SIZE / 2, y: byTop + FID_GAP + FID_SIZE / 2 },
    tr: { x: bx + BLOCK_W + FID_GAP + FID_SIZE / 2, y: byTop + FID_GAP + FID_SIZE / 2 },
    bl: { x: bx - FID_GAP - FID_SIZE / 2, y: byBot - FID_GAP - FID_SIZE / 2 },
    br: { x: bx + BLOCK_W + FID_GAP + FID_SIZE / 2, y: byBot - FID_GAP - FID_SIZE / 2 },
  };
  const drawFid = (cx: number, cy: number) => {
    const halo = FID_SIZE + 8;
    ref.page.drawRectangle({
      x: cx - halo / 2, y: cy - halo / 2, width: halo, height: halo, color: rgb(1, 1, 1),
    });
    ref.page.drawRectangle({
      x: cx - FID_SIZE / 2, y: cy - FID_SIZE / 2, width: FID_SIZE, height: FID_SIZE, color: rgb(0, 0, 0),
    });
  };
  drawFid(fidPositions.tl.x, fidPositions.tl.y);
  drawFid(fidPositions.tr.x, fidPositions.tr.y);
  drawFid(fidPositions.bl.x, fidPositions.bl.y);
  drawFid(fidPositions.br.x, fidPositions.br.y);

  // Draw rows
  const innerTop = byTop - BLOCK_PAD_TOP;
  for (let i = 0; i < objectiveSlots.length; i++) {
    const slot = objectiveSlots[i];
    const col = N_COLS === 2 ? Math.floor(i / rowsPerCol) : 0;
    const rowIdx = N_COLS === 2 ? i % rowsPerCol : i;
    const cellX = bx + BLOCK_PAD_X + col * (COL_W + COL_GAP);
    const cellY = innerTop - rowIdx * ROW_H;
    const labelText = `${String(slot.pos).padStart(2, "0")}.`;
    ref.page.drawText(labelText, {
      x: cellX, y: cellY - 10, size: 10, font: ctx.bold, color: rgb(0, 0, 0),
    });
    const bubblesStartX = cellX + NUM_COL_W + BUBBLE_R;
    const bubbles: OMRBubble[] = [];
    for (let k = 0; k < slot.nBubbles; k++) {
      const cx = bubblesStartX + k * BUBBLE_GAP;
      const cy = cellY - 7;
      ref.page.drawCircle({ x: cx, y: cy, size: BUBBLE_R, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
      ref.page.drawText(slot.labels[k], {
        x: cx - (slot.labels[k] === "V" || slot.labels[k] === "F" ? 2.5 : 2.2),
        y: cy - 2.5, size: 6.5, font: ctx.bold, color: rgb(0.35, 0.35, 0.4),
      });
      bubbles.push({ label: slot.labels[k], x: cx, y: cy, r: BUBBLE_R });
    }
    omrQuestions.push({ question_id: slot.qid, qtype: slot.qtype, bubbles });
  }

  // Advance cursor past the block (and its lower fiducials).
  ref.y = byBot - FID_SIZE - 18;

  // ---- Non-objective questions (rendered below, no bubbles) -----------------
  if (otherSlots.length > 0) {
    drawWrapped(ref, ctx, "Respostas dissertativas / lacunas:", {
      size: 10, bold: true, versionLabel: version.version_label, suppressVersion: true,
    });
    for (const slot of otherSlots) {
      ensureSpace(ctx, ref, 24, version.version_label, undefined, true);
      const label = `${String(slot.pos).padStart(2, "0")}.`;
      ref.page.drawText(label, { x: MARGIN_X, y: ref.y - 10, size: 10, font: ctx.bold, color: rgb(0, 0, 0) });
      if (slot.qtype === "fill_blank") {
        ref.page.drawLine({
          start: { x: MARGIN_X + 26, y: ref.y - 8 },
          end: { x: PAGE_W - MARGIN_X, y: ref.y - 8 },
          thickness: 0.5, color: rgb(0.55, 0.55, 0.6),
        });
      } else {
        ref.page.drawText("(Dissertativa — responder na folha da prova)", {
          x: MARGIN_X + 26, y: ref.y - 10, size: 9, font: ctx.font, color: rgb(0.35, 0.35, 0.4),
        });
      }
      omrQuestions.push({ question_id: slot.qid, qtype: slot.qtype, bubbles: [] });
      ref.y -= 22;
    }
  }

  return {
    page: { w: PAGE_W, h: PAGE_H },
    fiducials: fidPositions,
    fiducial_size: FID_SIZE,
    questions: omrQuestions,
  };
}

function randomControlNumber(): string {
  // Formato: MM + 4 dígitos sequenciais aleatórios + AA (ex.: 05000126).
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const ctrl = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${mm}${ctrl}${yy}`;
}

// Número de controle estável e ÚNICO por avaliação (e por folha quando recebe
// um seed distinto). Formato: MM + 4 dígitos derivados do seed + AA. O MM/AA
// vêm da data da avaliação (dd/mm/aaaa) quando disponível.
function makeControlNumber(date: string | null | undefined, seed: string): string {
  let mm: string;
  let yy: string;
  const m = String(date ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    mm = m[2];
    yy = m[3].slice(-2);
  } else {
    const now = new Date();
    mm = String(now.getMonth() + 1).padStart(2, "0");
    yy = String(now.getFullYear() % 100).padStart(2, "0");
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const ctrl = String(h % 10000).padStart(4, "0");
  return `${mm}${ctrl}${yy}`;
}

export async function buildAssessmentPDF(input: {
  header: Header;
  logoUrl: string | null;
  assessmentId?: string;
  layout?: "one_column" | "two_columns" | "mixed";
  questions: Question[];
  versions: Version[];
  assignments: Assignment[];
  mode?: "all" | "questions" | "answers" | "keys" | "student" | "teacher";
  controlNumber?: string;
  controlNumbers?: Record<string, string>;
  headerTemplate?: HeaderTemplate | null;
}): Promise<{ bytes: Uint8Array; bubbleLayouts: Record<string, OMRLayout> }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await fetchLogoImage(pdf, input.logoUrl);
  const template = input.headerTemplate ?? null;
  const templateLogo = template?.logo_url
    ? await fetchLogoImage(pdf, template.logo_url)
    : null;
  const controlNumber = (
    input.controlNumber || makeControlNumber(input.header.date, input.assessmentId ?? "base")
  ).toUpperCase();
  const ctx: Ctx = {
    pdf, font, bold, logo, header: input.header, controlNumber, sections: [], currentSection: null,
    template, templateLogo, student: null,
  };
  const mode = input.mode ?? "all";
  const layout = input.layout ?? "one_column";
  const wantsQuestions = mode === "all" || mode === "questions" || mode === "student";
  const wantsAnswers = mode === "all" || mode === "answers" || mode === "student";
  const wantsKeys = mode === "all" || mode === "keys" || mode === "teacher";
  const bubbleLayouts: Record<string, OMRLayout> = {};

  // Ordem solicitada: FOLHA DE RESPOSTAS primeiro (personalizada por aluno),
  // depois as folhas de questões, e por fim o gabarito do professor.
  if (wantsAnswers) {
    if (input.assignments.length > 0) {
      for (const asg of input.assignments) {
        const v = input.versions.find((x) => x.id === asg.version_id);
        if (!v) continue;
        // Cada aluno tem o SEU próprio arranjo (ordem de questões + alternativas
        // + gabarito). Quando presente no assignment, ele tem prioridade sobre o
        // arranjo padrão da versão, garantindo embaralhamento por aluno.
        const effV: Version = {
          ...v,
          question_order: asg.question_order && asg.question_order.length ? asg.question_order : v.question_order,
          option_orders:
            asg.option_orders && Object.keys(asg.option_orders).length ? asg.option_orders : v.option_orders,
          answer_key:
            asg.answer_key && Object.keys(asg.answer_key).length ? asg.answer_key : v.answer_key,
        };
        ctx.controlNumber = (input.controlNumbers?.[asg.id] || controlNumber).toUpperCase();
        ctx.student = { name: asg.student_name ?? "", enrollment: asg.enrollment_number ?? null };
        const omr = await drawAnswerSheet(ctx, asg, effV, input.questions);
        bubbleLayouts[asg.id] = omr;
        // Logo após a folha de respostas do aluno, renderiza as folhas de questões da sua versão.
        if (wantsQuestions) {
          drawQuestionsPages(
            ctx,
            { ...effV, _student_name: asg.student_name } as Version & { _student_name?: string },
            input.questions,
            layout,
          );
        }
        // Gabarito do professor ESPECÍFICO desta folha (mesmo embaralhamento
        // de questões e alternativas que o aluno recebeu). Sem isso, o
        // professor corrigia a partir de um gabarito da versão que não batia
        // com o arranjo individual do aluno.
        if (wantsKeys) {
          drawAnswerKeyPages(
            ctx,
            { ...effV, _student_name: asg.student_name } as Version & { _student_name?: string },
            input.questions,
          );
        }
      }
    } else {
      for (const v of input.versions) {
        await drawAnswerSheet(
          ctx,
          { id: "blank", student_id: "", student_name: "", version_id: v.id, copy_index: 1, qr_token: `template-${v.id}` },
          v,
          input.questions,
        );
        if (wantsQuestions) {
          drawQuestionsPages(ctx, v, input.questions, layout);
        }
        if (wantsKeys) {
          drawAnswerKeyPages(ctx, v, input.questions);
        }
      }
    }
  } else if (wantsQuestions) {
    if (input.assignments.length > 0) {
      // Folha de questões personalizada: preenche "Aluno: ... | Matrícula: ..."
      for (const asg of input.assignments) {
        const v = input.versions.find((x) => x.id === asg.version_id);
        if (!v) continue;
        const effV: Version = {
          ...v,
          question_order: asg.question_order && asg.question_order.length ? asg.question_order : v.question_order,
          option_orders:
            asg.option_orders && Object.keys(asg.option_orders).length ? asg.option_orders : v.option_orders,
          answer_key: asg.answer_key && Object.keys(asg.answer_key).length ? asg.answer_key : v.answer_key,
        };
        ctx.controlNumber = (input.controlNumbers?.[asg.id] || controlNumber).toUpperCase();
        ctx.student = { name: asg.student_name ?? "", enrollment: asg.enrollment_number ?? null };
        drawQuestionsPages(
          ctx,
          { ...effV, _student_name: asg.student_name } as Version & { _student_name?: string },
          input.questions,
          layout,
        );
      }
    } else {
      for (const v of input.versions) {
        drawQuestionsPages(ctx, v, input.questions, layout);
      }
    }
    if (wantsKeys) {
      for (const v of input.versions) {
        drawAnswerKeyPages(ctx, v, input.questions);
      }
    }
  }
  if (wantsKeys && !wantsAnswers && !wantsQuestions) {
    // Modo apenas gabarito: renderiza um gabarito por folha do aluno (quando
    // houver assignments) para que cada gabarito bata com o embaralhamento
    // individual. Sem assignments, cai no gabarito por versão.
    ctx.controlNumber = controlNumber;
    if (input.assignments.length > 0) {
      for (const asg of input.assignments) {
        const v = input.versions.find((x) => x.id === asg.version_id);
        if (!v) continue;
        const effV: Version = {
          ...v,
          question_order: asg.question_order && asg.question_order.length ? asg.question_order : v.question_order,
          option_orders:
            asg.option_orders && Object.keys(asg.option_orders).length ? asg.option_orders : v.option_orders,
          answer_key:
            asg.answer_key && Object.keys(asg.answer_key).length ? asg.answer_key : v.answer_key,
        };
        ctx.controlNumber = (input.controlNumbers?.[asg.id] || controlNumber).toUpperCase();
        drawAnswerKeyPages(
          ctx,
          { ...effV, _student_name: asg.student_name } as Version & { _student_name?: string },
          input.questions,
        );
      }
    } else {
      for (const v of input.versions) {
        drawAnswerKeyPages(ctx, v, input.questions);
      }
    }
  }

  // Rodapé com Folha X de Y e Nº de controle por seção.
  // Remove o rótulo de versão dos rodapés de seções voltadas ao aluno.
  for (const section of ctx.sections) {
    const total = section.pages.length;
    const isTeacher = /gabarito do professor/i.test(section.label);
    const isQuestions = section.label.includes("Folha de Questões");

    section.pages.forEach((p, idx) => {
      // PÁGINAS SEGUINTES DA FOLHA DE QUESTÕES: painel compacto de continuidade
      const publicLabel = isTeacher
        ? section.label
        : section.label
            .replace(/\s*—\s*Versão\s+\S+/i, "")
            .replace(/\s*-\s*Versão\s+\S+/i, "");

      const footer = isQuestions
        ? safe(`[ ${ctx.header.institution || "EstudaJá"} - ${ctx.header.discipline} | Folha de Questões ${idx + 1} de ${total} ]`)
        : safe(`${publicLabel}   ·   Folha ${idx + 1} de ${total}   ·   Nº ${section.controlNumber}`);

      p.drawText(footer, {
        x: MARGIN_X,
        y: MARGIN_Y - 18,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.55),
      });
    });
  }

  const bytes = await pdf.save();
  return { bytes, bubbleLayouts };
}
