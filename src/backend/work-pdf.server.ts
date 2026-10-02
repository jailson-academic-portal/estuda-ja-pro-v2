import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

/** Dimensões A4 em pontos (72 dpi). */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const CM = 28.3464567;

/** Margens ABNT: superior e esquerda 3 cm; inferior e direita 2 cm. */
const MARGIN_TOP = 3 * CM;
const MARGIN_LEFT = 3 * CM;
const MARGIN_BOTTOM = 2 * CM;
const MARGIN_RIGHT = 2 * CM;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

/** Arial/Times New Roman 12, espaçamento 1,5 entre linhas. */
const FONT_SIZE = 12;
const LINE_HEIGHT = FONT_SIZE * 1.5;

/** Recuo de primeira linha de parágrafo (1,25 cm). */
const PARAGRAPH_INDENT = 1.25 * CM;

/** Logo opcional no topo: no máximo 120x120 px (≈ 90 x 90 pt). */
const MAX_LOGO_SIZE = 120 * 0.75;

const BLACK = rgb(0, 0, 0);

export interface WorkCoverData {
  logo_data_url?: string | null;
  institution?: string | null;
  author?: string | null;
  title?: string | null;
  city?: string | null;
  year?: string | null;
}

export interface WorkSectionData {
  heading?: string | null;
  body?: string | null;
}

export interface AcademicWorkPDFInput {
  cover: WorkCoverData;
  sections?: WorkSectionData[];
}

interface RenderLine {
  text: string;
  x: number;
  width: number;
  bold: boolean;
  justify: boolean;
  spaceBefore: number;
}

/**
 * Normaliza o texto para o conjunto de caracteres aceito pelas fontes padrão
 * (WinAnsi/Latin-1), evitando erro de codificação na geração do PDF.
 */
function sanitizeText(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25CF\u25AA\u25E6]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "");
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Embute a logo (data URL ou URL http) — retorna null quando indisponível. */
async function embedLogo(doc: PDFDocument, source: string): Promise<PDFImage | null> {
  let dataUrl = source.trim();
  if (/^https?:\/\//i.test(dataUrl)) {
    const res = await fetch(dataUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
    dataUrl = `data:${mime};base64,${base64FromBytes(buf)}`;
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const bytes = bytesFromBase64(match[2]);
  const mime = match[1].toLowerCase();
  if (mime.includes("png")) return await doc.embedPng(bytes);
  if (mime.includes("jpeg") || mime.includes("jpg")) return await doc.embedJpg(bytes);
  return null;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
): void {
  if (!text) return;
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (A4_WIDTH - width) / 2, y, size, font, color: BLACK });
}

function drawLine(page: PDFPage, item: RenderLine, y: number, font: PDFFont): void {
  if (!item.text) return;
  if (!item.justify) {
    page.drawText(item.text, { x: item.x, y, size: FONT_SIZE, font, color: BLACK });
    return;
  }
  const words = item.text.split(" ").filter(Boolean);
  if (words.length < 2) {
    page.drawText(item.text, { x: item.x, y, size: FONT_SIZE, font, color: BLACK });
    return;
  }
  const spaceWidth = font.widthOfTextAtSize(" ", FONT_SIZE);
  const naturalWidth = font.widthOfTextAtSize(item.text, FONT_SIZE);
  const gaps = words.length - 1;
  const extra = (item.width - naturalWidth) / gaps;
  // Distribui o espaço restante entre as palavras (justificado), sem exagerar
  // nos espaços para não abrir "rios" no meio do texto.
  const space = extra > 0 && extra <= spaceWidth * 2.5 ? spaceWidth + extra : spaceWidth;
  let cursorX = item.x;
  for (const word of words) {
    page.drawText(word, { x: cursorX, y, size: FONT_SIZE, font, color: BLACK });
    cursorX += font.widthOfTextAtSize(word, FONT_SIZE) + space;
  }
}

/**
 * Gera o PDF do trabalho acadêmico do Assistente de Trabalho ABNT.
 *
 * Capa (ABNT NBR 14724), nesta ordem: logo opcional no topo (máx. 120x120 px),
 * nome da instituição em caixa alta centralizado, nome do autor(es) em caixa
 * alta de 3 a 5 linhas abaixo, título em caixa alta e negrito no meio da
 * página e cidade/ano centralizados no rodapé. Fonte Arial/Times New Roman 12
 * e margens 3 cm (superior/esquerda) e 2 cm (inferior/direita).
 */
export async function buildAcademicWorkPDF(input: AcademicWorkPDFInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  doc.setProducer("EstudaJá Pro");
  doc.setCreator("EstudaJá Pro");
  doc.setTitle(sanitizeText(input.cover.title).trim() || "Trabalho Acadêmico");

  /* ------------------------- CAPA ------------------------- */
  const coverPage = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN_TOP;

  // 1) Logo opcional no topo, centralizada, no máximo 120x120 px.
  const logoSource = (input.cover.logo_data_url ?? "").trim();
  if (logoSource) {
    try {
      const logo = await embedLogo(doc, logoSource);
      if (logo) {
        const scale = Math.min(MAX_LOGO_SIZE / logo.width, MAX_LOGO_SIZE / logo.height, 1);
        const width = logo.width * scale;
        const height = logo.height * scale;
        coverPage.drawImage(logo, {
          x: (A4_WIDTH - width) / 2,
          y: y - height,
          width,
          height,
        });
        y -= height + LINE_HEIGHT;
      }
    } catch {
      /* logo é opcional: se falhar, a capa sai sem ela */
    }
  }

  // 2) Nome da instituição — caixa alta, centralizado.
  const institution = sanitizeText(input.cover.institution).trim().toUpperCase();
  if (institution) {
    for (const line of wrapText(institution, regular, FONT_SIZE, CONTENT_WIDTH)) {
      drawCentered(coverPage, line, regular, FONT_SIZE, y);
      y -= LINE_HEIGHT;
    }
  }

  // 3) Nome do autor(es) — caixa alta, de 3 a 5 linhas abaixo da instituição.
  y -= LINE_HEIGHT * 3;
  const authorLines = sanitizeText(input.cover.author)
    .split(/[\n;]+/)
    .map((line) => line.trim().toUpperCase())
    .filter(Boolean);
  for (const author of authorLines) {
    for (const line of wrapText(author, regular, FONT_SIZE, CONTENT_WIDTH)) {
      drawCentered(coverPage, line, regular, FONT_SIZE, y);
      y -= LINE_HEIGHT;
    }
  }

  // 4) Título — caixa alta, negrito, no meio da página.
  const title = sanitizeText(input.cover.title).trim().toUpperCase();
  if (title) {
    const titleLines = wrapText(title, bold, FONT_SIZE, CONTENT_WIDTH);
    let titleY = A4_HEIGHT / 2 + ((titleLines.length - 1) * LINE_HEIGHT) / 2;
    for (const line of titleLines) {
      drawCentered(coverPage, line, bold, FONT_SIZE, titleY);
      titleY -= LINE_HEIGHT;
    }
  }

  // 5) Cidade e ano — centralizados no rodapé.
  const city = sanitizeText(input.cover.city).trim();
  const year = sanitizeText(input.cover.year).trim();
  const footer = [city, year].filter(Boolean).join(" - ");
  if (footer) drawCentered(coverPage, footer, regular, FONT_SIZE, MARGIN_BOTTOM);

  /* ---------------------- SEÇÕES ---------------------- */
  const sections = (input.sections ?? []).filter(
    (section) =>
      sanitizeText(section.heading).trim().length > 0 ||
      sanitizeText(section.body).trim().length > 0,
  );

  const items: RenderLine[] = [];

  for (const section of sections) {
    const heading = sanitizeText(section.heading).trim().toUpperCase();
    if (heading) {
      const headingLines = wrapText(heading, bold, FONT_SIZE, CONTENT_WIDTH);
      headingLines.forEach((line, index) => {
        items.push({
          text: line,
          x: MARGIN_LEFT,
          width: CONTENT_WIDTH,
          bold: true,
          justify: false,
          spaceBefore: index === 0 ? LINE_HEIGHT : 0,
        });
      });
      // Linha em branco entre o título da seção e o texto.
      items.push({
        text: "",
        x: MARGIN_LEFT,
        width: CONTENT_WIDTH,
        bold: false,
        justify: false,
        spaceBefore: 0,
      });
    }

    const paragraphs = sanitizeText(section.body)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
      .filter(Boolean);

    paragraphs.forEach((paragraph, paragraphIndex) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let index = 0;
      let firstLine = true;
      while (index < words.length) {
        const indent = firstLine ? PARAGRAPH_INDENT : 0;
        const maxWidth = CONTENT_WIDTH - indent;
        const lineWords: string[] = [];
        while (index < words.length) {
          const candidate = [...lineWords, words[index]].join(" ");
          if (
            lineWords.length > 0 &&
            regular.widthOfTextAtSize(candidate, FONT_SIZE) > maxWidth
          ) {
            break;
          }
          lineWords.push(words[index]);
          index += 1;
        }
        const isLastLine = index >= words.length;
        items.push({
          text: lineWords.join(" "),
          x: MARGIN_LEFT + indent,
          width: maxWidth,
          bold: false,
          justify: !isLastLine && lineWords.length > 1,
          spaceBefore: 0,
        });
        firstLine = false;
      }

      // Espaço entre parágrafos.
      if (paragraphIndex < paragraphs.length - 1) {
        items.push({
          text: "",
          x: MARGIN_LEFT,
          width: CONTENT_WIDTH,
          bold: false,
          justify: false,
          spaceBefore: 0,
        });
      }
    });
  }

  if (items.length) {
    let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    let cursorY = A4_HEIGHT - MARGIN_TOP;
    for (const item of items) {
      if (item.spaceBefore) cursorY -= item.spaceBefore;
      if (cursorY - LINE_HEIGHT < MARGIN_BOTTOM) {
        page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
        cursorY = A4_HEIGHT - MARGIN_TOP;
      }
      drawLine(page, item, cursorY, item.bold ? bold : regular);
      cursorY -= LINE_HEIGHT;
    }
  }

  return await doc.save();
}
