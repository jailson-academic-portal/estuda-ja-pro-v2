import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Ordenação natural crescente para itens contendo números (Módulo 1, Módulo 2... Módulo 10).
 * Prioriza campo numérico explícito 'number' se disponível.
 */
export const sortItemsNumerically = <T extends { name?: string; title?: string; number?: number }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    // 1. Se houver campo numérico explícito (order, number, order_index)
    if (a.number !== undefined && b.number !== undefined) {
      return a.number - b.number;
    }
    // 2. Ordenação natural de strings contendo números (Módulo 1, Módulo 2, Aula 1, etc)
    const textA = a.name || a.title || '';
    const textB = b.name || b.title || '';
    return textA.localeCompare(textB, undefined, { numeric: true, sensitivity: 'base' });
  });
};

export function getExamClassificationBadgeProps(classification: string) {
  const val = (classification || "").toLowerCase();
  if (val.includes("crit")) {
    return {
      variant: "destructive" as const,
      className: "bg-red-100 text-red-800 border-red-200"
    };
  }
  if (val.includes("alter") || val.includes("elev") || val.includes("baixo")) {
    return {
      variant: "secondary" as const,
      className: "bg-amber-100 text-amber-800 border-amber-200"
    };
  }
  return {
    variant: "outline" as const,
    className: "bg-green-100 text-green-800 border-green-200"
  };
}

/**
 * Parses a date string in DD/MM/YYYY format and returns a local Date object.
 */
export function parseBRDate(brDate: string): Date | null {
  const parts = brDate.split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

/**
 * Converts a Date object to YYYY-MM-DD string for database storage.
 */
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date or ISO date string to DD/MM/YYYY.
 */
export function formatBRDate(date: Date | string): string {
  const d = typeof date === "string" 
    ? (date.includes("T") ? new Date(date) : new Date(date + "T12:00:00")) 
    : date;
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
