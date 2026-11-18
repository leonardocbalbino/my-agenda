/**
 * Motor de disponibilidade (puro, sem I/O).
 *
 * Tudo é calculado em instantes UTC (ms). Regras semanais estão em hora LOCAL
 * da Location e são convertidas com o fuso dela, dia a dia, o que trata horário
 * de verão. Para a virada de dia, a jornada é montada para a véspera, o dia e o
 * dia seguinte e os intervalos encostados são unidos: um atendimento 23:30–00:20
 * cabe se houver expediente dos dois lados da meia-noite.
 */
import { addDays, localParts, toISODate, weekdayOf, zonedTime, type LocalDate } from "@/lib/time";

export type HHMM = string; // "09:00" ... "24:00"

export interface WeeklyRule {
  /** 0 = domingo ... 6 = sábado */
  weekday: number;
  start: HHMM;
  end: HHMM;
  validFrom?: string | null; // "YYYY-MM-DD", inclusivo
  validUntil?: string | null; // inclusivo
}

export interface EngineResource {
  id: string;
  name: string;
  sortOrder: number;
  /** Fuso IANA da Location do recurso. */
  timezone: string;
  rules: WeeklyRule[];
}

export interface AvailabilityExceptionInput {
  /** Nulo = vale para todos os recursos (a Location inteira). */
  resourceId: string | null;
  kind: "CLOSED" | "OPEN";
  start: Date;
  end: Date;
}

/** Reserva que ocupa o recurso (PENDING_PAYMENT ou CONFIRMED). */
export interface BusyPeriod {
  resourceId: string;
  start: Date;
  end: Date;
}

export interface PricingRuleInput {
  resourceId: string | null;
  /** Nulo = todos os dias. */
  weekdays: number[] | null;
  start: HHMM;
  end: HHMM;
  holidaysOnly: boolean;
  priceCents: number;
  priority: number;
}

export interface OfferingInput {
  mode: "SERVICE" | "RENTAL";
  durationMinutes: number | null;
  slotMinutes: number | null;
  basePriceCents: number;
}

export interface EngineInput {
  /** Dia pedido, no calendário local da Location. */
  date: LocalDate;
  offering: OfferingInput;
  resources: EngineResource[];
  exceptions?: AvailabilityExceptionInput[];
  busy?: BusyPeriod[];
  pricingRules?: PricingRuleInput[];
  /** Feriados em "YYYY-MM-DD". */
  holidays?: string[];
  now?: Date;
  /** Antecedência mínima para agendar. */
  leadMinutes?: number;
  /** Grade de horários para SERVICE (ex. 30 -> 09:00, 09:30...). */
  stepMinutes?: number;
}

export interface Slot {
  start: Date;
  end: Date;
  /** Hora local de início, "HH:MM". */
  localTime: HHMM;
  /** Livre para agendar agora (algum recurso livre e não está no passado). */
  available: boolean;
  /** Já passou (ou está dentro da antecedência mínima). */
  past: boolean;
  /** Recursos que trabalham nesse horário. */
  workingResourceIds: string[];
  /** Recursos que trabalham E estão livres. */
  freeResourceIds: string[];
  /** Sugestão para "Qualquer profissional": o livre com menos reservas no dia. */
  resourceId: string | null;
  priceCents: number;
}

// --- intervalos em ms ----------------------------------------------------------

type Iv = [number, number];
const MIN = 60_000;

export function mergeIntervals(ivs: Iv[]): Iv[] {
  const sorted = ivs.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Iv[] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1])
      last[1] = Math.max(last[1], e); // encostado também une
    else out.push([s, e]);
  }
  return out;
}

export function subtractIntervals(base: Iv[], cuts: Iv[]): Iv[] {
  let result = mergeIntervals(base);
  for (const [cs, ce] of mergeIntervals(cuts)) {
    const next: Iv[] = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) next.push([s, e]);
      else {
        if (cs > s) next.push([s, cs]);
        if (ce < e) next.push([ce, e]);
      }
    }
    result = next;
  }
  return result;
}

const covers = (ivs: Iv[], s: number, e: number) => ivs.some(([a, b]) => a <= s && e <= b);

// --- hora local ------------------------------------------------------------------

const parts = localParts;

const toMinutes = (hhmm: HHMM) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function ruleApplies(rule: WeeklyRule, day: LocalDate): boolean {
  if (rule.weekday !== weekdayOf(day)) return false;
  const iso = toISODate(day);
  if (rule.validFrom && iso < rule.validFrom) return false;
  if (rule.validUntil && iso > rule.validUntil) return false;
  return true;
}

// --- motor -------------------------------------------------------------------------

interface ResourceState {
  r: EngineResource;
  working: Iv[];
  free: Iv[];
  bookingsToday: number;
}

export function computeSlots(input: EngineInput): Slot[] {
  const { date, offering } = input;
  const exceptions = input.exceptions ?? [];
  const busy = input.busy ?? [];
  const now = (input.now ?? new Date()).getTime() + (input.leadMinutes ?? 0) * MIN;
  const duration = offering.mode === "SERVICE" ? offering.durationMinutes : offering.slotMinutes;
  if (!duration || duration <= 0) throw new RangeError("Oferta sem duração/slot válido");
  const step = input.stepMinutes ?? 30;
  const dateIso = toISODate(date);
  const days = [addDays(date, -1), date, addDays(date, 1)];

  const states: ResourceState[] = input.resources.map((r) => {
    const base: Iv[] = [];
    for (const day of days) {
      for (const rule of r.rules) {
        if (!ruleApplies(rule, day)) continue;
        base.push([
          zonedTime(day, rule.start, r.timezone).getTime(),
          zonedTime(day, rule.end, r.timezone).getTime(),
        ]);
      }
    }
    const mine = exceptions.filter((x) => x.resourceId === null || x.resourceId === r.id);
    const opened = mine
      .filter((x) => x.kind === "OPEN")
      .map((x): Iv => [x.start.getTime(), x.end.getTime()]);
    const closed = mine
      .filter((x) => x.kind === "CLOSED")
      .map((x): Iv => [x.start.getTime(), x.end.getTime()]);
    const working = subtractIntervals([...base, ...opened], closed);

    const myBusy = busy.filter((b) => b.resourceId === r.id);
    const free = subtractIntervals(
      working,
      myBusy.map((b): Iv => [b.start.getTime(), b.end.getTime()]),
    );
    const bookingsToday = myBusy.filter((b) => parts(b.start, r.timezone).date === dateIso).length;
    return { r, working, free, bookingsToday };
  });

  // Candidatos de início.
  const starts = new Set<number>();
  for (const st of states) {
    if (offering.mode === "SERVICE") {
      for (let m = 0; m < 24 * 60; m += step) {
        const hhmm = toHHMM(m);
        const s = zonedTime(date, hhmm, st.r.timezone);
        // Hora local inexistente (início do horário de verão) é pulada.
        if (parts(s, st.r.timezone).time !== hhmm) continue;
        starts.add(s.getTime());
      }
    } else {
      // Locação: slots alinhados ao início de cada janela de trabalho.
      for (const [ws, we] of st.working) {
        for (let s = ws; s + duration * MIN <= we; s += duration * MIN) starts.add(s);
      }
    }
  }

  const slots: Slot[] = [];
  for (const s of [...starts].sort((a, b) => a - b)) {
    const e = s + duration * MIN;
    const working = states.filter((st) => covers(st.working, s, e));
    if (working.length === 0) continue;
    const tz = working[0].r.timezone;
    const local = parts(new Date(s), tz);
    if (local.date !== dateIso) continue; // o slot pertence ao dia em que começa

    const free = working
      .filter((st) => covers(st.free, s, e))
      .sort(
        (a, b) =>
          a.bookingsToday - b.bookingsToday ||
          a.r.sortOrder - b.r.sortOrder ||
          a.r.name.localeCompare(b.r.name),
      );
    const past = s < now;
    const suggested = free[0]?.r.id ?? null;
    slots.push({
      start: new Date(s),
      end: new Date(e),
      localTime: local.time,
      available: free.length > 0 && !past,
      past,
      workingResourceIds: working.map((st) => st.r.id),
      freeResourceIds: free.map((st) => st.r.id),
      resourceId: suggested,
      priceCents: priceFor(input, local, suggested ?? working[0].r.id),
    });
  }
  return slots;
}

/** Regra de preço de maior prioridade que casa com dia, horário de início e recurso. */
export function priceFor(
  input: Pick<EngineInput, "offering" | "pricingRules" | "holidays" | "date">,
  local: { date: string; time: HHMM },
  resourceId: string,
): number {
  const [y, m, d] = local.date.split("-").map(Number);
  const weekday = weekdayOf({ year: y, month: m, day: d });
  const isHoliday = (input.holidays ?? []).includes(local.date);
  const minute = toMinutes(local.time);
  const match = (input.pricingRules ?? [])
    .filter(
      (r) =>
        (r.resourceId === null || r.resourceId === resourceId) &&
        (r.weekdays === null || r.weekdays.includes(weekday)) &&
        (!r.holidaysOnly || isHoliday) &&
        toMinutes(r.start) <= minute &&
        minute < toMinutes(r.end),
    )
    .sort((a, b) => b.priority - a.priority || (b.resourceId ? 1 : 0) - (a.resourceId ? 1 : 0));
  return match[0]?.priceCents ?? input.offering.basePriceCents;
}
