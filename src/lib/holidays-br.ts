// Calculator for Brazilian national holidays (fixed + Easter-derived movable).
// No external API. Returns ISO YYYY-MM-DD strings.

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm (Meeus / Jones / Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export function brazilianNationalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, name: "Confraternização Universal" },
    { date: iso(addDays(easter, -48)), name: "Carnaval (segunda)" },
    { date: iso(addDays(easter, -47)), name: "Carnaval (terça)" },
    { date: iso(addDays(easter, -46)), name: "Quarta-feira de Cinzas (até meio-dia)" },
    { date: iso(addDays(easter, -2)), name: "Sexta-feira Santa" },
    { date: iso(easter), name: "Páscoa" },
    { date: `${year}-04-21`, name: "Tiradentes" },
    { date: `${year}-05-01`, name: "Dia do Trabalho" },
    { date: iso(addDays(easter, 60)), name: "Corpus Christi" },
    { date: `${year}-09-07`, name: "Independência do Brasil" },
    { date: `${year}-10-12`, name: "Nossa Senhora Aparecida" },
    { date: `${year}-11-02`, name: "Finados" },
    { date: `${year}-11-15`, name: "Proclamação da República" },
    { date: `${year}-11-20`, name: "Consciência Negra" },
    { date: `${year}-12-25`, name: "Natal" },
  ];
}

export function holidaysInRange(startISO: string, endISO: string): Holiday[] {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  const out: Holiday[] = [];
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    for (const h of brazilianNationalHolidays(y)) {
      if (h.date >= startISO && h.date <= endISO) out.push(h);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export interface EffectiveDatesInput {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  weekDays: string[]; // ["mon","wed",...]
  holidays: string[]; // YYYY-MM-DD
  academicWeekStart?: string | null;
  academicWeekEnd?: string | null;
}

export function effectiveClassDates(input: EffectiveDatesInput): string[] {
  const wanted = new Set(
    input.weekDays.map((d) => WEEKDAY_INDEX[d]).filter((n) => n !== undefined),
  );
  const holidaySet = new Set(input.holidays);
  const out: string[] = [];
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  const acStart = input.academicWeekStart || null;
  const acEnd = input.academicWeekEnd || null;
  for (let dt = new Date(start); dt <= end; dt = addDays(dt, 1)) {
    if (!wanted.has(dt.getUTCDay())) continue;
    const iso10 = iso(dt);
    if (holidaySet.has(iso10)) continue;
    if (acStart && acEnd && iso10 >= acStart && iso10 <= acEnd) continue;
    out.push(iso10);
  }
  return out;
}