/**
 * Criação, cancelamento e expiração de reservas.
 *
 * A trava final contra double-booking é a exclusion constraint do banco
 * (bookings_no_overlap). Aqui o horário é revalidado no motor de disponibilidade
 * e, se outro cliente ganhar a corrida, o erro 23P01 vira SLOT_TAKEN.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  bookings,
  customerProfiles,
  locations,
  offeringResources,
  offerings,
  recurringBookings,
  resources,
} from "@/db/schema";
import { addDays, localParts, parseISODate, weekdayOf, zonedTime } from "@/lib/time";
import { getAvailableSlots, type Slot } from "@/modules/scheduling";
import { withContext, withTenant } from "@/modules/tenancy/context";
import { prepaidAmount } from "./pricing";
import type { BookingStatus } from "./status";

/** Por quanto tempo uma reserva com pagamento online segura o horário. */
export const PENDING_HOLD_MINUTES = 10;
/** Cancelamento grátis pelo cliente até X horas antes. */
export const FREE_CANCEL_HOURS = 2;
/** Mensalista: quantas semanas são reservadas por ciclo. */
export const RECURRING_WEEKS = 4;

export type BookingErrorCode =
  | "OFFERING_NOT_FOUND"
  | "SLOT_UNAVAILABLE"
  | "SLOT_TAKEN"
  | "RECURRING_NOT_ALLOWED"
  | "RECURRING_CONFLICT"
  | "NOT_FOUND"
  | "NOT_CANCELLABLE"
  | "CANCEL_WINDOW_CLOSED";

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface CreatedBooking {
  id: string;
  status: BookingStatus;
  resourceId: string;
  start: Date;
  end: Date;
  priceCents: number;
  prepaidCents: number;
  expiresAt: Date | null;
}

export interface BookingDeps {
  /** Chamado depois do COMMIT para cada reserva pendente (agenda a expiração). */
  onPending?: (b: { tenantId: string; bookingId: string; expiresAt: Date }) => Promise<void>;
  now?: () => Date;
}

const isExclusionViolation = (e: unknown) => {
  let x = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 5; i++) {
    if (x.code === "23P01") return true;
    x = x.cause as typeof x;
  }
  return false;
};

/** Cancela as pendências vencidas do tenant (dentro do contexto dele). */
async function expireDueInTenant(tx: Tx, now: Date) {
  return tx
    .update(bookings)
    .set({ status: "CANCELLED", cancelledAt: now, cancelReason: "PAYMENT_EXPIRED", updatedAt: now })
    .where(and(eq(bookings.status, "PENDING_PAYMENT"), lte(bookings.expiresAt, now)))
    .returning({ id: bookings.id });
}

async function upsertCustomerProfile(tx: Tx, tenantId: string, customer: Customer) {
  const name = customer.name.trim() || customer.email.split("@")[0];
  const [profile] = await tx
    .insert(customerProfiles)
    .values({ tenantId, userId: customer.id, name, email: customer.email })
    .onConflictDoUpdate({
      target: [customerProfiles.tenantId, customerProfiles.userId],
      set: { email: customer.email, updatedAt: new Date() },
    })
    .returning({ id: customerProfiles.id });
  return profile.id;
}

interface OfferingContext {
  offering: typeof offerings.$inferSelect;
  timezone: string;
}

async function loadOffering(
  db: Db,
  tenantId: string,
  offeringId: string,
): Promise<OfferingContext> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ offering: offerings, timezone: locations.timezone })
      .from(offerings)
      .innerJoin(offeringResources, eq(offeringResources.offeringId, offerings.id))
      .innerJoin(resources, eq(resources.id, offeringResources.resourceId))
      .innerJoin(locations, eq(locations.id, resources.locationId))
      .where(and(eq(offerings.id, offeringId), eq(offerings.active, true)))
      .orderBy(asc(resources.sortOrder))
      .limit(1),
  );
  if (!rows[0]) throw new BookingError("OFFERING_NOT_FOUND", "Serviço não encontrado");
  return rows[0];
}

/** Revalida o horário pedido no motor (mesma regra que a tela usou). */
async function findSlot(
  db: Db,
  tenantId: string,
  ctx: OfferingContext,
  start: Date,
  resourceId: string | null,
  now: Date,
): Promise<Slot> {
  const date = localParts(start, ctx.timezone).date;
  const { slots } = await getAvailableSlots(db, tenantId, {
    offeringId: ctx.offering.id,
    resourceId,
    date,
    now,
  }).catch((e) => {
    throw new BookingError("SLOT_UNAVAILABLE", "Horário indisponível", e);
  });
  const slot = slots.find((s) => s.start.getTime() === start.getTime());
  if (!slot?.available) throw new BookingError("SLOT_UNAVAILABLE", "Horário indisponível");
  return slot;
}

export interface CreateBookingInput {
  offeringId: string;
  /** Nulo = "Qualquer": o sistema escolhe entre os livres. */
  resourceId: string | null;
  start: Date;
  source: "MARKETPLACE" | "TENANT_PAGE" | "PANEL";
}

export async function createBooking(
  db: Db,
  tenantId: string,
  customer: Customer,
  input: CreateBookingInput,
  deps: BookingDeps = {},
): Promise<CreatedBooking> {
  const now = deps.now?.() ?? new Date();
  const ctx = await loadOffering(db, tenantId, input.offeringId);
  const slot = await findSlot(db, tenantId, ctx, input.start, input.resourceId, now);

  const price = slot.priceCents;
  const prepaid = prepaidAmount(price, ctx.offering.paymentPolicy, ctx.offering.depositBps);
  const pending = prepaid > 0;
  const expiresAt = pending ? new Date(now.getTime() + PENDING_HOLD_MINUTES * 60_000) : null;

  // "Qualquer": tenta os livres em ordem; se alguém ganhar a corrida num, tenta o próximo.
  const candidates = input.resourceId ? [input.resourceId] : slot.freeResourceIds;
  for (const resourceId of candidates) {
    try {
      const created = await withTenant(
        db,
        tenantId,
        async (tx) => {
          await expireDueInTenant(tx, now);
          const customerProfileId = await upsertCustomerProfile(tx, tenantId, customer);
          const [row] = await tx
            .insert(bookings)
            .values({
              tenantId,
              customerProfileId,
              customerId: customer.id,
              resourceId,
              offeringId: ctx.offering.id,
              period: { start: slot.start, end: slot.end },
              status: pending ? "PENDING_PAYMENT" : "CONFIRMED",
              priceCents: price,
              prepaidCents: prepaid,
              source: input.source,
              expiresAt,
              createdByUserId: customer.id,
            })
            .returning();
          return row;
        },
        customer.id,
      );
      if (pending) {
        await deps.onPending?.({ tenantId, bookingId: created.id, expiresAt: expiresAt! });
      }
      return {
        id: created.id,
        status: created.status,
        resourceId: created.resourceId,
        start: created.period.start,
        end: created.period.end,
        priceCents: created.priceCents,
        prepaidCents: created.prepaidCents,
        expiresAt: created.expiresAt,
      };
    } catch (e) {
      if (!isExclusionViolation(e)) throw e;
    }
  }
  throw new BookingError("SLOT_TAKEN", "Esse horário acabou de ser reservado por outra pessoa");
}

export interface CreateRecurringInput {
  offeringId: string;
  resourceId: string;
  /** Primeira ocorrência. As seguintes repetem dia da semana e hora local. */
  start: Date;
  source: CreateBookingInput["source"];
}

/**
 * Mensalista: cria a regra semanal e as próximas RECURRING_WEEKS ocorrências,
 * tudo ou nada. Fica pendente até o primeiro pagamento mensal.
 */
export async function createRecurringBooking(
  db: Db,
  tenantId: string,
  customer: Customer,
  input: CreateRecurringInput,
  deps: BookingDeps = {},
) {
  const now = deps.now?.() ?? new Date();
  const ctx = await loadOffering(db, tenantId, input.offeringId);
  if (!ctx.offering.allowRecurring) {
    throw new BookingError("RECURRING_NOT_ALLOWED", "Este serviço não aceita mensalista");
  }
  const local = localParts(input.start, ctx.timezone);
  const firstDay = parseISODate(local.date)!;

  const occurrences: Slot[] = [];
  const conflicts: string[] = [];
  for (let week = 0; week < RECURRING_WEEKS; week++) {
    const day = addDays(firstDay, week * 7);
    const start = zonedTime(day, local.time, ctx.timezone);
    try {
      occurrences.push(await findSlot(db, tenantId, ctx, start, input.resourceId, now));
    } catch {
      conflicts.push(localParts(start, ctx.timezone).date);
    }
  }
  if (conflicts.length) {
    throw new BookingError("RECURRING_CONFLICT", "Algumas semanas já estão ocupadas", {
      conflicts,
    });
  }

  const monthly = occurrences.reduce((sum, s) => sum + s.priceCents, 0);
  const expiresAt = new Date(now.getTime() + PENDING_HOLD_MINUTES * 60_000);
  const durationMinutes = Math.round(
    (occurrences[0].end.getTime() - occurrences[0].start.getTime()) / 60_000,
  );

  try {
    const result = await withTenant(
      db,
      tenantId,
      async (tx) => {
        await expireDueInTenant(tx, now);
        const customerProfileId = await upsertCustomerProfile(tx, tenantId, customer);
        const [recurring] = await tx
          .insert(recurringBookings)
          .values({
            tenantId,
            customerProfileId,
            resourceId: input.resourceId,
            offeringId: ctx.offering.id,
            weekday: weekdayOf(firstDay),
            startTime: local.time,
            durationMinutes,
            startsOn: local.date,
            monthlyPriceCents: monthly,
          })
          .returning();
        const rows = await tx
          .insert(bookings)
          .values(
            occurrences.map((s) => ({
              tenantId,
              customerProfileId,
              customerId: customer.id,
              resourceId: input.resourceId,
              offeringId: ctx.offering.id,
              recurringBookingId: recurring.id,
              period: { start: s.start, end: s.end },
              status: "PENDING_PAYMENT" as const,
              priceCents: s.priceCents,
              prepaidCents: s.priceCents,
              source: input.source,
              expiresAt,
              createdByUserId: customer.id,
            })),
          )
          .returning({ id: bookings.id, period: bookings.period });
        return { recurring, rows };
      },
      customer.id,
    );
    for (const r of result.rows) {
      await deps.onPending?.({ tenantId, bookingId: r.id, expiresAt });
    }
    return {
      recurringId: result.recurring.id,
      monthlyPriceCents: monthly,
      bookingIds: result.rows.map((r) => r.id),
      firstBookingId: result.rows[0].id,
      expiresAt,
    };
  } catch (e) {
    if (isExclusionViolation(e)) {
      throw new BookingError("SLOT_TAKEN", "Um dos horários acabou de ser reservado");
    }
    throw e;
  }
}

/**
 * Política de cancelamento pelo cliente (usada pela tela e pela ação):
 * pendente pode ser desistido a qualquer momento; confirmado, até
 * FREE_CANCEL_HOURS antes do início.
 */
export function customerCancellation(
  status: BookingStatus,
  start: Date,
  now: Date,
): "OK" | "NOT_CANCELLABLE" | "CANCEL_WINDOW_CLOSED" {
  if (status === "PENDING_PAYMENT") return "OK";
  if (status !== "CONFIRMED") return "NOT_CANCELLABLE";
  return now.getTime() <= start.getTime() - FREE_CANCEL_HOURS * 3_600_000
    ? "OK"
    : "CANCEL_WINDOW_CLOSED";
}

/** Cliente cancela a própria reserva, dentro da política. */
export async function cancelBookingByCustomer(
  db: Db,
  tenantId: string,
  customerId: string,
  bookingId: string,
  deps: Pick<BookingDeps, "now"> = {},
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await withTenant(
    db,
    tenantId,
    async (tx) => {
      const [b] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.customerId, customerId)))
        .for("update");
      if (!b) throw new BookingError("NOT_FOUND", "Agendamento não encontrado");
      const verdict = customerCancellation(b.status, b.period.start, now);
      if (verdict === "NOT_CANCELLABLE") {
        throw new BookingError("NOT_CANCELLABLE", "Este agendamento não pode mais ser cancelado");
      }
      if (verdict === "CANCEL_WINDOW_CLOSED") {
        throw new BookingError(
          "CANCEL_WINDOW_CLOSED",
          `Cancelamento pelo app só até ${FREE_CANCEL_HOURS}h antes. Fale com o estabelecimento.`,
        );
      }
      await tx
        .update(bookings)
        .set({ status: "CANCELLED", cancelledAt: now, cancelReason: "CUSTOMER", updatedAt: now })
        .where(eq(bookings.id, b.id));
    },
    customerId,
  );
}

/** Job por reserva: expira se ainda estiver pendente e vencida. */
export async function expireBooking(db: Db, tenantId: string, bookingId: string, now = new Date()) {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .update(bookings)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "PAYMENT_EXPIRED",
        updatedAt: now,
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.status, "PENDING_PAYMENT"),
          lte(bookings.expiresAt, now),
        ),
      )
      .returning({ id: bookings.id, recurringBookingId: bookings.recurringBookingId }),
  );
  const recurringId = rows[0]?.recurringBookingId;
  if (recurringId) {
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(recurringBookings)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(and(eq(recurringBookings.id, recurringId), eq(recurringBookings.status, "ACTIVE"))),
    );
  }
  return rows.length > 0;
}

/** Varredura de segurança entre tenants (função SECURITY DEFINER, drizzle/0004). */
export async function sweepExpiredBookings(db: Db, now = new Date()) {
  const r = await db.execute<{ booking_id: string; tenant_id: string }>(
    sql`select * from expire_pending_bookings(${now.toISOString()}::timestamptz)`,
  );
  return r.rows;
}

export interface CustomerBookingView {
  id: string;
  status: BookingStatus;
  offeringName: string;
  resourceName: string;
  start: Date;
  end: Date;
  timezone: string;
  priceCents: number;
  prepaidCents: number;
  expiresAt: Date | null;
  cancelReason: string | null;
  recurring: boolean;
  /** O cliente pode cancelar agora (mesma regra de cancelBookingByCustomer). */
  canCancel: boolean;
}

/** Detalhe de uma reserva do PRÓPRIO cliente (página de confirmação). */
export async function getCustomerBooking(
  db: Db,
  tenantId: string,
  customerId: string,
  bookingId: string,
  now = new Date(),
): Promise<CustomerBookingView | null> {
  const rows = await withTenant(
    db,
    tenantId,
    (tx) =>
      tx
        .select({
          id: bookings.id,
          status: bookings.status,
          offeringName: offerings.name,
          resourceName: resources.name,
          period: bookings.period,
          timezone: locations.timezone,
          priceCents: bookings.priceCents,
          prepaidCents: bookings.prepaidCents,
          expiresAt: bookings.expiresAt,
          cancelReason: bookings.cancelReason,
          recurringBookingId: bookings.recurringBookingId,
        })
        .from(bookings)
        .innerJoin(offerings, eq(offerings.id, bookings.offeringId))
        .innerJoin(resources, eq(resources.id, bookings.resourceId))
        .innerJoin(locations, eq(locations.id, resources.locationId))
        .where(and(eq(bookings.id, bookingId), eq(bookings.customerId, customerId))),
    customerId,
  );
  const b = rows[0];
  if (!b) return null;
  const { period, recurringBookingId, ...rest } = b;
  return {
    ...rest,
    start: period.start,
    end: period.end,
    recurring: recurringBookingId !== null,
    canCancel: customerCancellation(b.status, period.start, now) === "OK",
  };
}

export interface MyBooking {
  id: string;
  tenantSlug: string;
  tenantName: string;
  offeringName: string;
  resourceName: string;
  start: Date;
  end: Date;
  timezone: string;
  status: BookingStatus;
  priceCents: number;
}

/** Separa "Próximos" (ativos e ainda não terminados, do mais cedo) dos demais. */
export function splitMyBookings(all: MyBooking[], now = new Date()) {
  const isUpcoming = (b: MyBooking) =>
    b.end.getTime() > now.getTime() && (b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT");
  return {
    upcoming: all.filter(isUpcoming).sort((a, b) => a.start.getTime() - b.start.getTime()),
    past: all.filter((b) => !isUpcoming(b)),
  };
}

/** "Meus agendamentos": todas as reservas do cliente, em qualquer tenant. */
export async function listMyBookings(db: Db, userId: string): Promise<MyBooking[]> {
  const r = await withContext(db, { tenantId: null, userId }, (tx) =>
    tx.execute<{
      booking_id: string;
      tenant_slug: string;
      tenant_name: string;
      offering_name: string;
      resource_name: string;
      starts_at: Date | string;
      ends_at: Date | string;
      timezone: string;
      status: BookingStatus;
      price_cents: number;
    }>(sql`select * from my_bookings()`),
  );
  return r.rows.map((x) => ({
    id: x.booking_id,
    tenantSlug: x.tenant_slug,
    tenantName: x.tenant_name,
    offeringName: x.offering_name,
    resourceName: x.resource_name,
    start: new Date(x.starts_at),
    end: new Date(x.ends_at),
    timezone: x.timezone,
    status: x.status,
    priceCents: x.price_cents,
  }));
}
