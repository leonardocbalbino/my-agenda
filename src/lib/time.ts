import { TZDate } from "@date-fns/tz";

/** Data civil (sem hora, sem fuso). Mês 1–12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** "Hoje" no fuso informado. */
export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  const z = new TZDate(now.getTime(), timeZone);
  return { year: z.getFullYear(), month: z.getMonth() + 1, day: z.getDate() };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  // Meio-dia UTC evita qualquer efeito de fuso na aritmética de datas civis.
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = domingo ... 6 = sábado (independe de fuso: é a data civil). */
export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay();
}

/**
 * Instante UTC de uma hora local ("18:30", ou "24:00" = meia-noite do dia seguinte)
 * numa data civil e num fuso IANA.
 */
export function zonedTime(date: LocalDate, hhmm: string, timeZone: string): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`Hora inválida: ${hhmm}`);
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new RangeError(`Hora inválida: ${hhmm}`);
  const d = h === 24 ? addDays(date, 1) : date;
  const z = new TZDate(d.year, d.month - 1, d.day, h % 24, min, 0, timeZone);
  return new Date(z.getTime());
}

export function toISODate({ year, month, day }: LocalDate): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Data civil ("YYYY-MM-DD") e hora ("HH:MM") de um instante num fuso IANA. */
export function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function parseISODate(iso: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return check.getUTCMonth() === d.month - 1 && check.getUTCDate() === d.day ? d : null;
}
