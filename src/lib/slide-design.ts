/**
 * Shared design tokens for the "Criador de Slides" (Gamma-style, no images).
 *
 * The teacher picks a COLOR THEME and a TEMPLATE (layout style) in the UI.
 * These choices are stored with the generation (prompt.color_theme /
 * prompt.template) and read back at export time by both the PPTX and PDF
 * builders so the deck design is deterministic and shared.
 */

export type SlideColorThemeKey =
  | "variado"
  | "teal"
  | "azul"
  | "vinho"
  | "esmeralda"
  | "ambar"
  | "roxo"
  | "grafite"
  | "oceano"
  | "laranja"
  | "rosa"
  | "lima"
  | "indigo";

export type SlideTemplateKey = "moderno" | "classico" | "escuro" | "minimalista";

export type SlideColorTheme = {
  key: SlideColorThemeKey;
  label: string;
  swatch: string; // css hex for the UI dot
  accents: string[]; // rotating accents per module (hex, no #)
  cover: string; // dark cover / divider base (hex, no #)
};

export const SLIDE_COLOR_THEMES: Record<SlideColorThemeKey, SlideColorTheme> = {
  variado: {
    key: "variado",
    label: "Variado",
    swatch: "#4338CA",
    accents: ["0F766E", "4338CA", "B45309", "9F1239", "047857", "6D28D9", "0369A1", "BE123C"],
    cover: "0B2138",
  },
  teal: {
    key: "teal",
    label: "Turquesa",
    swatch: "#0F766E",
    accents: ["0F766E", "0E7490", "115E59", "047857"],
    cover: "042F2E",
  },
  azul: {
    key: "azul",
    label: "Azul",
    swatch: "#1D4ED8",
    accents: ["1D4ED8", "2563EB", "1E40AF", "3730A3"],
    cover: "0B2138",
  },
  vinho: {
    key: "vinho",
    label: "Vinho",
    swatch: "#9F1239",
    accents: ["9F1239", "BE123C", "881337", "A21CAF"],
    cover: "3B0714",
  },
  esmeralda: {
    key: "esmeralda",
    label: "Esmeralda",
    swatch: "#047857",
    accents: ["047857", "059669", "065F46", "15803D"],
    cover: "052E16",
  },
  ambar: {
    key: "ambar",
    label: "Âmbar",
    swatch: "#B45309",
    accents: ["B45309", "D97706", "92400E", "C2410C"],
    cover: "271203",
  },
  roxo: {
    key: "roxo",
    label: "Roxo",
    swatch: "#6D28D9",
    accents: ["6D28D9", "7C3AED", "5B21B6", "4338CA"],
    cover: "1E1035",
  },
  grafite: {
    key: "grafite",
    label: "Grafite",
    swatch: "#334155",
    accents: ["334155", "475569", "1E293B", "0F172A"],
    cover: "0F172A",
  },
  oceano: {
    key: "oceano",
    label: "Oceano",
    swatch: "#0369A1",
    accents: ["0369A1", "0284C7", "075985", "0E7490"],
    cover: "082F49",
  },
  laranja: {
    key: "laranja",
    label: "Laranja",
    swatch: "#EA580C",
    accents: ["EA580C", "F97316", "C2410C", "9A3412"],
    cover: "3A1005",
  },
  rosa: {
    key: "rosa",
    label: "Rosa",
    swatch: "#DB2777",
    accents: ["DB2777", "E11D48", "BE185D", "9D174D"],
    cover: "3F0620",
  },
  lima: {
    key: "lima",
    label: "Lima",
    swatch: "#4D7C0F",
    accents: ["4D7C0F", "65A30D", "3F6212", "166534"],
    cover: "1A2E05",
  },
  indigo: {
    key: "indigo",
    label: "Índigo",
    swatch: "#4338CA",
    accents: ["4338CA", "4F46E5", "3730A3", "312E81"],
    cover: "1E1B4B",
  },
};

export type SlideTemplate = {
  key: SlideTemplateKey;
  label: string;
  description: string;
};

export const SLIDE_TEMPLATES: Record<SlideTemplateKey, SlideTemplate> = {
  moderno: {
    key: "moderno",
    label: "Moderno",
    description: "Capa escura, divisórias coloridas e conteúdo claro com trilho lateral.",
  },
  classico: {
    key: "classico",
    label: "Clássico",
    description: "Fundo claro, títulos com barra de destaque e visual sóbrio.",
  },
  escuro: {
    key: "escuro",
    label: "Escuro",
    description: "Apresentação toda em tema escuro, com texto claro e acentos vivos.",
  },
  minimalista: {
    key: "minimalista",
    label: "Minimalista",
    description: "Muito espaço em branco, linhas finas e marcadores discretos.",
  },
};

export function resolveSlideDesign(
  themeKey: unknown,
  templateKey: unknown,
): { accents: string[]; cover: string; template: SlideTemplateKey } {
  const theme =
    typeof themeKey === "string" && themeKey in SLIDE_COLOR_THEMES
      ? SLIDE_COLOR_THEMES[themeKey as SlideColorThemeKey]
      : SLIDE_COLOR_THEMES.variado;
  const template =
    typeof templateKey === "string" && templateKey in SLIDE_TEMPLATES
      ? (templateKey as SlideTemplateKey)
      : "moderno";
  return { accents: theme.accents, cover: theme.cover, template };
}
