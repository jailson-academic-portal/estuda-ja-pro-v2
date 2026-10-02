/**
 * Padronização dos títulos de eventos do calendário gerados pelos módulos.
 * Formato: `[Tipo de Atividade]: [Título/Tema] - [Módulo ou Aula de Referência]`
 */

/** Extrai uma referência de Aula/Módulo de um texto livre (título, instruções, etc.). */
export function extractLessonReference(...texts: Array<string | null | undefined>): string | null {
  for (const raw of texts) {
    const text = String(raw ?? "");
    if (!text.trim()) continue;
    const aula = text.match(/aula\s*0*(\d+)/i);
    if (aula) return `Aula ${Number(aula[1])}`;
    const mod = text.match(/m[óo]dulo\s*0*(\d+)/i);
    if (mod) return `Módulo ${Number(mod[1])}`;
  }
  return null;
}

/** Remove um sufixo " - Aula 4" / " — Módulo 2" do fim do título. */
export function stripReferenceSuffix(title: string): string {
  return String(title ?? "")
    .replace(/\s*[-–—]\s*(aula|m[óo]dulo)\s*0*\d+\s*$/i, "")
    .trim();
}

export function buildCalendarEventTitle(
  typeLabel: string,
  title: string,
  reference?: string | null,
): string {
  const base = `${typeLabel}: ${stripReferenceSuffix(title) || "Sem título"}`;
  return reference ? `${base} - ${reference}` : base;
}

/** Linha de apoio abaixo do título: "Data de envio até 23:59". */
export function formatDueLine(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `Data de envio: ${date} até ${time}`;
}

/** Rótulo da segunda linha do evento, diferenciando aulas de entregas/avaliações. */
export function formatEventTimeLine(
  iso: string,
  source: "custom" | "activity" | "work" | "exercise" | "case" | "assessment" | string,
): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (source === "custom") return `Horário da aula: ${time}`;
  if (source === "assessment") return `Data da avaliação: ${date} · Horário da avaliação: ${time}`;
  return `Data de envio: ${date} até ${time}`;
}

/** Padroniza qualquer data/hora de entrega para 23:59 no fuso local se a hora não for fornecida. */
export function normalizeDueDate(isoOrDate: string | Date | null | undefined, forceEndOfDay = true): string | null {
  if (!isoOrDate) return null;
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;

  // Se for apenas uma data (YYYY-MM-DD), ou se pedirmos explicitamente para forçar o fim do dia
  if (forceEndOfDay && typeof isoOrDate === 'string' && isoOrDate.length <= 10) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:00`;
    return new Date(local).toISOString();
  }
  
  return d.toISOString();
}