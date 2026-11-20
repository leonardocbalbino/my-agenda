import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  availabilityExceptions,
  availabilityRules,
  locations,
  offeringResources,
  offerings,
  pricingRules,
  resources,
} from "@/db/schema";
import { addDays, todayIn, toISODate, weekdayOf, zonedTime, type LocalDate } from "@/lib/time";
import { withTenant } from "@/modules/tenancy/context";

/** Dados públicos de um tenant para a página de agendamento. */
export interface PublicCatalog {
  location: { name: string; neighborhood: string; city: string; timezone: string } | null;
  offerings: PublicOffering[];
  resources: PublicResource[];
  rules: {
    resourceId: string;
    weekday: number;
    end: string;
    validFrom: string | null;
    validUntil: string | null;
  }[];
  /** Fechamentos da unidade inteira (feriado, reforma) nas próximas semanas. */
  closures: { start: Date; end: Date }[];
}

export interface PublicOffering {
  id: string;
  name: string;
  mode: "SERVICE" | "RENTAL";
  durationMinutes: number | null;
  slotMinutes: number | null;
  basePriceCents: number;
  paymentPolicy: "ON_SITE" | "DEPOSIT" | "FULL";
  depositBps: number;
  allowRecurring: boolean;
  resourceIds: string[];
  /** Ex.: { label: "Horário nobre", from: "18:00" } */
  highlight: { label: string; from: string } | null;
}

export interface PublicResource {
  id: string;
  name: string;
  kind: "PROFESSIONAL" | "SPACE" | "EQUIPMENT";
}

export async function getPublicCatalog(db: Db, tenantId: string): Promise<PublicCatalog> {
  return withTenant(db, tenantId, async (tx) => {
    const [loc] = await tx
      .select({
        name: locations.name,
        neighborhood: locations.neighborhood,
        city: locations.city,
        timezone: locations.timezone,
      })
      .from(locations)
      .limit(1);
    const offs = await tx
      .select()
      .from(offerings)
      .where(eq(offerings.active, true))
      .orderBy(asc(offerings.sortOrder), asc(offerings.name));
    const res = await tx
      .select({ id: resources.id, name: resources.name, kind: resources.kind })
      .from(resources)
      .where(eq(resources.active, true))
      .orderBy(asc(resources.sortOrder), asc(resources.name));
    const links = await tx.select().from(offeringResources);
    const rules = await tx
      .select({
        resourceId: availabilityRules.resourceId,
        weekday: availabilityRules.weekday,
        end: availabilityRules.endTime,
        validFrom: availabilityRules.validFrom,
        validUntil: availabilityRules.validUntil,
      })
      .from(availabilityRules);
    const prices = await tx.select().from(pricingRules).orderBy(asc(pricingRules.startTime));
    const closed = await tx
      .select({ period: availabilityExceptions.period })
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.kind, "CLOSED"),
          isNull(availabilityExceptions.resourceId),
          sql`upper(${availabilityExceptions.period}) > now()`,
          sql`lower(${availabilityExceptions.period}) < now() + interval '35 days'`,
        ),
      );

    const activeIds = new Set(res.map((r) => r.id));
    return {
      location: loc ?? null,
      closures: closed.map((c) => c.period),
      resources: res,
      rules: rules.map((r) => ({ ...r, end: r.end.slice(0, 5) })),
      offerings: offs.map((o) => {
        const hl = prices.find((p) => p.offeringId === o.id && p.label && !p.holidaysOnly);
        return {
          id: o.id,
          name: o.name,
          mode: o.mode,
          durationMinutes: o.durationMinutes,
          slotMinutes: o.slotMinutes,
          basePriceCents: o.basePriceCents,
          paymentPolicy: o.paymentPolicy,
          depositBps: o.depositBps,
          allowRecurring: o.allowRecurring,
          resourceIds: links
            .filter((l) => l.offeringId === o.id && activeIds.has(l.resourceId))
            .map((l) => l.resourceId),
          highlight: hl ? { label: hl.label!, from: hl.startTime.slice(0, 5) } : null,
        };
      }),
    };
  });
}

/** O dia inteiro (00:00–24:00 local) está dentro de um fechamento da unidade? */
function closedAllDay(catalog: PublicCatalog, day: LocalDate, tz: string) {
  const from = zonedTime(day, "00:00", tz).getTime();
  const to = zonedTime(day, "24:00", tz).getTime();
  return catalog.closures.some((c) => c.start.getTime() <= from && c.end.getTime() >= to);
}

function worksOn(catalog: PublicCatalog, resourceIds: string[], day: LocalDate) {
  const iso = toISODate(day);
  const wd = weekdayOf(day);
  return catalog.rules.filter(
    (r) =>
      resourceIds.includes(r.resourceId) &&
      r.weekday === wd &&
      (!r.validFrom || iso >= r.validFrom) &&
      (!r.validUntil || iso <= r.validUntil),
  );
}

/** Próximos `n` dias em que algum dos recursos trabalha (olha até 4 semanas). */
export function openDays(catalog: PublicCatalog, resourceIds: string[], n = 5, now = new Date()) {
  const tz = catalog.location?.timezone ?? "America/Sao_Paulo";
  const today = todayIn(tz, now);
  const days: LocalDate[] = [];
  for (let i = 0; i < 28 && days.length < n; i++) {
    const d = addDays(today, i);
    if (worksOn(catalog, resourceIds, d).length && !closedAllDay(catalog, d, tz)) days.push(d);
  }
  return { today, days };
}

/** "Aberto hoje até 21h" | "Aberto hoje até meia-noite" | "Fechado hoje". */
export function openingLabel(catalog: PublicCatalog, now = new Date()): string {
  const tz = catalog.location?.timezone ?? "America/Sao_Paulo";
  const rules = worksOn(
    catalog,
    catalog.resources.map((r) => r.id),
    todayIn(tz, now),
  );
  if (!rules.length) return "Fechado hoje";
  const end = rules
    .map((r) => r.end)
    .sort()
    .at(-1)!;
  if (end === "24:00") return "Aberto hoje até meia-noite";
  const [h, m] = end.split(":");
  return `Aberto hoje até ${Number(h)}h${m === "00" ? "" : m}`;
}
