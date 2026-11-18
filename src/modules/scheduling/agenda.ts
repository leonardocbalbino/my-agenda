/**
 * Agenda do dia para o painel: colunas por recurso, blocos de reservas e
 * bloqueios em minutos locais (para posicionar na grade) e indicadores.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  customerProfiles,
  locations,
  offerings,
  resources,
} from "@/db/schema";
import {
  addDays,
  localParts,
  parseISODate,
  toISODate,
  zonedTime,
  type LocalDate,
} from "@/lib/time";
import type { BookingStatus } from "@/modules/booking/status";
import { withTenant } from "@/modules/tenancy/context";
import { workingIntervals, type EngineResource } from "./engine";

export interface AgendaBooking {
  id: string;
  resourceId: string;
  customerName: string;
  offeringName: string;
  status: BookingStatus;
  source: "MARKETPLACE" | "TENANT_PAGE" | "PANEL";
  start: Date;
  end: Date;
  /** Minutos desde 00:00 local do dia exibido (podem passar de 0..1440 nas bordas). */
  startMin: number;
  endMin: number;
  priceCents: number;
  prepaidCents: number;
  /** Cliente confirmou presença pelo WhatsApp. */
  customerConfirmed: boolean;
}

export interface AgendaBlock {
  id: string;
  resourceId: string | null;
  reason: string | null;
  startMin: number;
  endMin: number;
}

export interface AgendaColumn {
  id: string;
  name: string;
  /** Faixas de expediente do dia, em minutos locais. */
  working: [number, number][];
}

export interface AgendaKpis {
  bookings: number;
  fromMarketplace: number;
  forecastCents: number;
  paidOnlineCents: number;
  /** 0..100, ou null se ninguém trabalha no dia. */
  occupancy: number | null;
  /** Maior janela livre do dia, ex. { from: 840, to: 960 } (14h–16h). */
  longestFree: { from: number; to: number } | null;
  /** Faltas no mês: no-show / (concluídos + no-show), 0..100, ou null sem dados. */
  noShowRate: number | null;
}

export interface DayAgenda {
  date: string;
  timezone: string;
  /** Instante (ms UTC) da meia-noite local do dia: base dos minutos da grade. */
  dayStartMs: number;
  columns: AgendaColumn[];
  bookings: AgendaBooking[];
  blocks: AgendaBlock[];
  /** Faixa da grade em minutos locais (hora cheia). */
  range: { from: number; to: number };
  kpis: AgendaKpis;
}

const ACTIVE: BookingStatus[] = ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"];

/** Minutos locais de um instante relativo à meia-noite local de `day` (pode ser < 0 ou > 1440). */
function minutesFrom(dayMidnight: number, instant: Date) {
  return Math.round((instant.getTime() - dayMidnight) / 60_000);
}

export async function getDayAgenda(
  db: Db,
  tenantId: string,
  dateIso: string,
  opts: { onlyResourceId?: string | null } = {},
): Promise<DayAgenda> {
  const date = parseISODate(dateIso);
  if (!date) throw new RangeError(`Data inválida: ${dateIso}`);

  return withTenant(db, tenantId, async (tx) => {
    const cols = await tx
      .select({
        id: resources.id,
        name: resources.name,
        sortOrder: resources.sortOrder,
        timezone: locations.timezone,
        locationId: resources.locationId,
      })
      .from(resources)
      .innerJoin(locations, eq(locations.id, resources.locationId))
      .where(
        and(
          eq(resources.active, true),
          opts.onlyResourceId ? eq(resources.id, opts.onlyResourceId) : undefined,
        ),
      )
      .orderBy(asc(resources.sortOrder), asc(resources.name));
    const timezone = cols[0]?.timezone ?? "America/Sao_Paulo";
    const ids = cols.map((c) => c.id);
    const midnight = zonedTime(date, "00:00", timezone).getTime();
    const nextMidnight = zonedTime(date, "24:00", timezone).getTime();
    const dayRange = sql`tstzrange(${new Date(midnight).toISOString()}::timestamptz, ${new Date(nextMidnight).toISOString()}::timestamptz)`;

    if (!ids.length) {
      return {
        date: dateIso,
        timezone,
        dayStartMs: midnight,
        columns: [],
        bookings: [],
        blocks: [],
        range: { from: 9 * 60, to: 18 * 60 },
        kpis: emptyKpis(),
      };
    }

    const rules = await tx
      .select()
      .from(availabilityRules)
      .where(inArray(availabilityRules.resourceId, ids));
    const exc = await tx
      .select()
      .from(availabilityExceptions)
      .where(sql`${availabilityExceptions.period} && ${dayRange}`);
    const rows = await tx
      .select({
        id: bookings.id,
        resourceId: bookings.resourceId,
        customerName: customerProfiles.name,
        offeringName: offerings.name,
        status: bookings.status,
        source: bookings.source,
        period: bookings.period,
        priceCents: bookings.priceCents,
        prepaidCents: bookings.prepaidCents,
        customerConfirmedAt: bookings.customerConfirmedAt,
      })
      .from(bookings)
      .innerJoin(customerProfiles, eq(customerProfiles.id, bookings.customerProfileId))
      .innerJoin(offerings, eq(offerings.id, bookings.offeringId))
      .where(
        and(
          inArray(bookings.resourceId, ids),
          ne(bookings.status, "CANCELLED"),
          sql`${bookings.period} && ${dayRange}`,
        ),
      )
      .orderBy(sql`lower(${bookings.period})`);

    const exceptions = exc.map((x) => ({
      resourceId: x.resourceId,
      locationId: x.locationId,
      kind: x.kind,
      start: x.period.start,
      end: x.period.end,
    }));
    const columns: AgendaColumn[] = cols.map((c) => {
      const er: EngineResource = {
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        timezone,
        rules: rules
          .filter((r) => r.resourceId === c.id)
          .map((r) => ({
            weekday: r.weekday,
            start: r.startTime.slice(0, 5),
            end: r.endTime.slice(0, 5),
            validFrom: r.validFrom,
            validUntil: r.validUntil,
          })),
      };
      // Do próprio recurso, ou da unidade inteira (resource_id nulo) onde ele fica.
      const scoped = exceptions.filter(
        (x) => x.resourceId === c.id || (x.resourceId === null && x.locationId === c.locationId),
      );
      const working = workingIntervals(er, [date], scoped)
        .map(([s, e]): [number, number] => [
          Math.max(0, minutesFrom(midnight, new Date(s))),
          Math.min(1440, minutesFrom(midnight, new Date(e))),
        ])
        .filter(([s, e]) => e > s);
      return { id: c.id, name: c.name, working };
    });

    const agendaBookings: AgendaBooking[] = rows.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      customerName: b.customerName,
      offeringName: b.offeringName,
      status: b.status,
      source: b.source,
      start: b.period.start,
      end: b.period.end,
      startMin: minutesFrom(midnight, b.period.start),
      endMin: minutesFrom(midnight, b.period.end),
      priceCents: b.priceCents,
      prepaidCents: b.prepaidCents,
      customerConfirmed: b.customerConfirmedAt !== null,
    }));

    const blocks: AgendaBlock[] = exc
      .filter((x) => x.kind === "CLOSED" && (x.resourceId === null || ids.includes(x.resourceId)))
      .map((x) => ({
        id: x.id,
        resourceId: x.resourceId,
        reason: x.reason,
        startMin: Math.max(0, minutesFrom(midnight, x.period.start)),
        endMin: Math.min(1440, minutesFrom(midnight, x.period.end)),
      }));

    // Faixa da grade: do primeiro início ao último fim (expediente, reservas e bloqueios).
    const edges = [
      ...columns.flatMap((c) => c.working.flat()),
      ...agendaBookings.flatMap((b) => [Math.max(0, b.startMin), Math.min(1440, b.endMin)]),
    ];
    const range = edges.length
      ? {
          from: Math.floor(Math.min(...edges) / 60) * 60,
          to: Math.ceil(Math.max(...edges) / 60) * 60,
        }
      : { from: 9 * 60, to: 18 * 60 };

    // Faltas no mês (no fuso local): reservas que começaram no mês.
    const monthStart = zonedTime({ ...date, day: 1 }, "00:00", timezone);
    const nextMonth = zonedTime(
      date.month === 12
        ? { year: date.year + 1, month: 1, day: 1 }
        : { year: date.year, month: date.month + 1, day: 1 },
      "00:00",
      timezone,
    );
    const [month] = await tx
      .select({
        noShow: sql<number>`count(*) filter (where ${bookings.status} = 'NO_SHOW')::int`,
        done: sql<number>`count(*) filter (where ${bookings.status} in ('NO_SHOW', 'COMPLETED'))::int`,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.resourceId, ids),
          sql`lower(${bookings.period}) >= ${monthStart.toISOString()}::timestamptz`,
          sql`lower(${bookings.period}) < ${nextMonth.toISOString()}::timestamptz`,
        ),
      );

    return {
      date: dateIso,
      timezone,
      dayStartMs: midnight,
      columns,
      bookings: agendaBookings,
      blocks,
      range,
      kpis: computeKpis(
        columns,
        agendaBookings,
        month.done ? (month.noShow * 100) / month.done : null,
      ),
    };
  });
}

function emptyKpis(): AgendaKpis {
  return {
    bookings: 0,
    fromMarketplace: 0,
    forecastCents: 0,
    paidOnlineCents: 0,
    occupancy: null,
    longestFree: null,
    noShowRate: null,
  };
}

const overlap = (a: [number, number], b: [number, number]) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** Indicadores do dia (puro, testável). */
export function computeKpis(
  columns: AgendaColumn[],
  list: AgendaBooking[],
  noShowRate: number | null,
): AgendaKpis {
  const active = list.filter((b) => ACTIVE.includes(b.status) || b.status === "NO_SHOW");
  const counted = list.filter((b) => b.status !== "CANCELLED");
  const workingMinutes = columns.reduce(
    (sum, c) => sum + c.working.reduce((s, [a, b]) => s + b - a, 0),
    0,
  );
  let busyMinutes = 0;
  let longestFree: AgendaKpis["longestFree"] = null;
  for (const c of columns) {
    const mine = active.filter((b) => b.resourceId === c.id);
    for (const w of c.working) {
      busyMinutes += mine.reduce((s, b) => s + overlap(w, [b.startMin, b.endMin]), 0);
      // Janelas livres dentro do expediente desta coluna.
      let cursor = w[0];
      for (const b of [...mine].sort((x, y) => x.startMin - y.startMin)) {
        if (b.endMin <= cursor || b.startMin >= w[1]) continue;
        if (
          b.startMin > cursor &&
          (!longestFree || b.startMin - cursor > longestFree.to - longestFree.from)
        ) {
          longestFree = { from: cursor, to: Math.min(b.startMin, w[1]) };
        }
        cursor = Math.max(cursor, b.endMin);
      }
      if (w[1] > cursor && (!longestFree || w[1] - cursor > longestFree.to - longestFree.from)) {
        longestFree = { from: cursor, to: w[1] };
      }
    }
  }
  return {
    bookings: counted.length,
    fromMarketplace: counted.filter((b) => b.source === "MARKETPLACE").length,
    forecastCents: list
      .filter((b) => ACTIVE.includes(b.status))
      .reduce((s, b) => s + b.priceCents, 0),
    paidOnlineCents: list
      .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
      .reduce((s, b) => s + b.prepaidCents, 0),
    occupancy: workingMinutes ? Math.round((busyMinutes * 100) / workingMinutes) : null,
    longestFree,
    noShowRate: noShowRate === null ? null : Math.round(noShowRate),
  };
}

/** Navegação de dias do painel. */
export function shiftDay(dateIso: string, days: number): string {
  const d = parseISODate(dateIso);
  if (!d) throw new RangeError(`Data inválida: ${dateIso}`);
  return toISODate(addDays(d, days));
}

export function todayIso(timezone: string, now = new Date()): string {
  return localParts(now, timezone).date;
}

export type { LocalDate };
