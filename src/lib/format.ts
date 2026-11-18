const oneDecimal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 4.9 -> "4,9" */
export function formatRating(value: number): string {
  return oneDecimal.format(value);
}

/** 850 -> "850 m" · 1234 -> "1,2 km". Distância vem do PostGIS em metros (inteiro). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${oneDecimal.format(Math.round(meters / 100) / 10)} km`;
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const sameDay = (a: { year: number; month: number; day: number }, b: typeof a) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/** Chip de dia: { top: "Hoje" | "Sáb", bottom: "07" }. */
export function dayChip(
  d: { year: number; month: number; day: number },
  today: typeof d,
): { top: string; bottom: string; full: string } {
  const wd = new Date(Date.UTC(d.year, d.month - 1, d.day, 12)).getUTCDay();
  const top = sameDay(d, today) ? "Hoje" : WEEKDAY_SHORT[wd];
  const bottom = String(d.day).padStart(2, "0");
  const full = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)));
  return { top, bottom, full };
}

/** "Hoje 18:30" · "Amanhã 18:30" · "Sáb 07/11 18:30", no fuso da Location. */
export function whenLabel(start: Date, timeZone: string, now = new Date()): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(start);
  const day = fmt(start);
  if (day === fmt(now)) return `Hoje ${time}`;
  if (day === fmt(new Date(now.getTime() + 86_400_000))) return `Amanhã ${time}`;
  const [, m, dd] = day.split("-");
  const wd = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short" })
    .format(start)
    .replace(".", "");
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dd}/${m} ${time}`;
}

/** "sábado, 7 de novembro, 18:30–19:20" */
export function longPeriod(start: Date, end: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  return `${date}, ${t(start)}–${t(end)}`;
}

/** Hora local "HH:MM" de um instante. */
export function clock(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}
