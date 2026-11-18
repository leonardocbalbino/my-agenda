import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  holidays,
  locations,
  offeringResources,
  offerings,
  pricingRules,
  resources,
} from "@/db/schema";
import { addDays, type LocalDate } from "@/lib/time";
import { BLOCKING_STATUSES } from "@/modules/booking/status";
import { withTenant } from "@/modules/tenancy/context";
import { computeSlots, type EngineResource, type Slot } from "./engine";

export class AvailabilityError extends Error {
  constructor(
    readonly code: "OFFERING_NOT_FOUND" | "RESOURCE_NOT_FOUND" | "INVALID_DATE",
    message: string,
  ) {
    super(message);
  }
}

export interface AvailabilityQuery {
  offeringId: string;
  /** Omitido = "Qualquer profissional/quadra" entre os recursos da oferta. */
  resourceId?: string | null;
  /** Dia no calendário local da Location: "YYYY-MM-DD". */
  date: string;
  now?: Date;
  leadMinutes?: number;
  stepMinutes?: number;
}

export interface Availability {
  timezone: string;
  resources: { id: string; name: string }[];
  slots: Slot[];
}

function parseDate(iso: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new AvailabilityError("INVALID_DATE", `Data inválida: ${iso}`);
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day));
  if (check.getUTCMonth() !== d.month - 1 || check.getUTCDate() !== d.day) {
    throw new AvailabilityError("INVALID_DATE", `Data inválida: ${iso}`);
  }
  return d;
}

/** "09:00:00" -> "09:00"; "24:00:00" -> "24:00". */
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Horários do dia para uma oferta, considerando jornada semanal, exceções,
 * reservas que ocupam o recurso (PENDING_PAYMENT e CONFIRMED, as mesmas da
 * exclusion constraint) e duração. Roda sob o RLS do tenant.
 */
export async function getAvailableSlots(
  db: Db,
  tenantId: string,
  query: AvailabilityQuery,
): Promise<Availability> {
  const date = parseDate(query.date);

  const input = await withTenant(db, tenantId, async (tx) => {
    const [offering] = await tx
      .select()
      .from(offerings)
      .where(and(eq(offerings.id, query.offeringId), eq(offerings.active, true)))
      .limit(1);
    if (!offering) throw new AvailabilityError("OFFERING_NOT_FOUND", "Serviço não encontrado");

    const linked = await tx
      .select({
        id: resources.id,
        name: resources.name,
        sortOrder: resources.sortOrder,
        locationId: resources.locationId,
        timezone: locations.timezone,
        stateCode: locations.stateCode,
      })
      .from(offeringResources)
      .innerJoin(resources, eq(resources.id, offeringResources.resourceId))
      .innerJoin(locations, eq(locations.id, resources.locationId))
      .where(
        and(
          eq(offeringResources.offeringId, offering.id),
          eq(resources.active, true),
          query.resourceId ? eq(resources.id, query.resourceId) : undefined,
        ),
      )
      .orderBy(asc(resources.sortOrder), asc(resources.name));
    if (query.resourceId && linked.length === 0) {
      throw new AvailabilityError("RESOURCE_NOT_FOUND", "Profissional ou espaço não encontrado");
    }
    if (linked.length === 0)
      return { offering, linked, rules: [], exc: [], busy: [], prices: [], hol: [] };

    const ids = linked.map((r) => r.id);
    const locationIds = [...new Set(linked.map((r) => r.locationId))];
    // Janela folgada: cobre véspera e dia seguinte em qualquer fuso (±14h).
    const from = new Date(Date.UTC(date.year, date.month - 1, date.day - 2)).toISOString();
    const to = new Date(Date.UTC(date.year, date.month - 1, date.day + 3)).toISOString();
    const window = sql`tstzrange(${from}::timestamptz, ${to}::timestamptz)`;

    // Em sequência: uma transação usa uma única conexão (sem queries concorrentes).
    const rules = await tx
      .select()
      .from(availabilityRules)
      .where(inArray(availabilityRules.resourceId, ids));
    const exc = await tx
      .select()
      .from(availabilityExceptions)
      .where(
        and(
          sql`${availabilityExceptions.period} && ${window}`,
          or(
            inArray(availabilityExceptions.resourceId, ids),
            and(
              isNull(availabilityExceptions.resourceId),
              inArray(availabilityExceptions.locationId, locationIds),
            ),
          ),
        ),
      );
    const busy = await tx
      .select({ resourceId: bookings.resourceId, period: bookings.period })
      .from(bookings)
      .where(
        and(
          inArray(bookings.resourceId, ids),
          inArray(bookings.status, [...BLOCKING_STATUSES]),
          // Pendência vencida não conta: createBooking a cancela antes de gravar a nova.
          sql`(${bookings.status} <> 'PENDING_PAYMENT' or ${bookings.expiresAt} > ${(query.now ?? new Date()).toISOString()}::timestamptz)`,
          sql`${bookings.period} && ${window}`,
        ),
      );
    const prices = await tx
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.offeringId, offering.id));

    const states = [...new Set(linked.map((r) => r.stateCode))];
    const hol = await tx
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          sql`${holidays.date} between ${from}::date and ${to}::date`,
          or(isNull(holidays.stateCode), inArray(holidays.stateCode, states)),
        ),
      );
    return { offering, linked, rules, exc, busy, prices, hol };
  });

  const engineResources: EngineResource[] = input.linked.map((r) => ({
    id: r.id,
    name: r.name,
    sortOrder: r.sortOrder,
    timezone: r.timezone,
    rules: input.rules
      .filter((x) => x.resourceId === r.id)
      .map((x) => ({
        weekday: x.weekday,
        start: hhmm(x.startTime),
        end: hhmm(x.endTime),
        validFrom: x.validFrom,
        validUntil: x.validUntil,
      })),
  }));

  // Exceções de Location valem para os recursos daquela Location.
  const locationOf = new Map(input.linked.map((r) => [r.id, r.locationId]));
  const exceptions = input.exc.flatMap((x) =>
    x.resourceId
      ? [{ resourceId: x.resourceId, kind: x.kind, start: x.period.start, end: x.period.end }]
      : input.linked
          .filter((r) => locationOf.get(r.id) === x.locationId)
          .map((r) => ({
            resourceId: r.id,
            kind: x.kind,
            start: x.period.start,
            end: x.period.end,
          })),
  );

  const slots = computeSlots({
    date,
    offering: input.offering,
    resources: engineResources,
    exceptions,
    busy: input.busy.map((b) => ({
      resourceId: b.resourceId,
      start: b.period.start,
      end: b.period.end,
    })),
    pricingRules: input.prices.map((p) => ({
      resourceId: p.resourceId,
      weekdays: p.weekdays,
      start: hhmm(p.startTime),
      end: hhmm(p.endTime),
      holidaysOnly: p.holidaysOnly,
      priceCents: p.priceCents,
      priority: p.priority,
    })),
    holidays: input.hol.map((h) => h.date),
    now: query.now,
    leadMinutes: query.leadMinutes,
    stepMinutes: query.stepMinutes,
  });

  return {
    timezone: input.linked[0]?.timezone ?? "America/Sao_Paulo",
    resources: input.linked.map((r) => ({ id: r.id, name: r.name })),
    slots,
  };
}

/** Datas dos próximos `n` dias a partir de `from` (chips "Hoje, Sáb, Seg..."). */
export function nextDays(from: LocalDate, n: number): LocalDate[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}
