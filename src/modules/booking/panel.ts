/**
 * Ações do painel do estabelecimento sobre reservas e bloqueios.
 * Toda função recebe quem está agindo (membership) e revalida a permissão aqui,
 * além do guard da página: STAFF só mexe na própria agenda.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  customerProfiles,
  locations,
  offeringResources,
  resources,
} from "@/db/schema";
import { addDays, localParts, parseISODate } from "@/lib/time";
import type { Membership } from "@/modules/identity/membership";
import { canAccessResource } from "@/modules/identity/permissions";
import { workingIntervals, type EngineResource } from "@/modules/scheduling/engine";
import { getAvailableSlots } from "@/modules/scheduling";
import { withTenant } from "@/modules/tenancy/context";
import { canTransition, type BookingStatus } from "./status";

export type PanelErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OUTSIDE_HOURS"
  | "INVALID_TRANSITION"
  | "NOT_STARTED"
  | "RESOURCE_MISMATCH"
  | "SLOT_UNAVAILABLE"
  | "INVALID_INPUT";

export class PanelError extends Error {
  constructor(
    readonly code: PanelErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  membership: Pick<Membership, "role" | "resourceId">;
}

const isExclusion = (e: unknown) => {
  let x = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 5; i++) {
    if (x.code === "23P01") return true;
    x = x.cause as typeof x;
  }
  return false;
};

function assertCanManage(actor: Actor, resourceId: string) {
  if (!canAccessResource(actor.membership, resourceId, "manage")) {
    throw new PanelError("FORBIDDEN", "Você só pode alterar a sua própria agenda");
  }
}

/** O intervalo [start, end) cabe no expediente do recurso (regras + exceções)? */
async function withinWorkingHours(tx: Tx, resourceId: string, start: Date, end: Date) {
  const [r] = await tx
    .select({
      id: resources.id,
      name: resources.name,
      sortOrder: resources.sortOrder,
      timezone: locations.timezone,
      locationId: resources.locationId,
    })
    .from(resources)
    .innerJoin(locations, eq(locations.id, resources.locationId))
    .where(eq(resources.id, resourceId));
  if (!r) throw new PanelError("NOT_FOUND", "Profissional ou espaço não encontrado");
  const rules = await tx
    .select()
    .from(availabilityRules)
    .where(eq(availabilityRules.resourceId, resourceId));
  const window = sql`tstzrange(${new Date(start.getTime() - 86_400_000).toISOString()}::timestamptz, ${new Date(end.getTime() + 86_400_000).toISOString()}::timestamptz)`;
  const exc = await tx
    .select()
    .from(availabilityExceptions)
    .where(
      and(
        sql`${availabilityExceptions.period} && ${window}`,
        sql`(${availabilityExceptions.resourceId} = ${resourceId} or (${availabilityExceptions.resourceId} is null and ${availabilityExceptions.locationId} = ${r.locationId}))`,
      ),
    );
  const er: EngineResource = {
    id: r.id,
    name: r.name,
    sortOrder: r.sortOrder,
    timezone: r.timezone,
    rules: rules.map((x) => ({
      weekday: x.weekday,
      start: x.startTime.slice(0, 5),
      end: x.endTime.slice(0, 5),
      validFrom: x.validFrom,
      validUntil: x.validUntil,
    })),
  };
  const day = parseISODate(localParts(start, r.timezone).date)!;
  const ivs = workingIntervals(
    er,
    [addDays(day, -1), day, addDays(day, 1)],
    exc.map((x) => ({
      resourceId: x.resourceId,
      kind: x.kind,
      start: x.period.start,
      end: x.period.end,
    })),
  );
  return ivs.some(([s, e]) => s <= start.getTime() && end.getTime() <= e);
}

/** Arrastar e soltar: muda horário e/ou profissional, mantendo a duração. */
export async function rescheduleBooking(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: { bookingId: string; resourceId: string; start: Date },
) {
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const [b] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .for("update");
      if (!b) throw new PanelError("NOT_FOUND", "Agendamento não encontrado");
      if (b.status !== "CONFIRMED" && b.status !== "PENDING_PAYMENT") {
        throw new PanelError("INVALID_TRANSITION", "Só agendamentos ativos podem ser remarcados");
      }
      assertCanManage(actor, b.resourceId);
      assertCanManage(actor, input.resourceId);

      if (input.resourceId !== b.resourceId) {
        const [link] = await tx
          .select()
          .from(offeringResources)
          .where(
            and(
              eq(offeringResources.offeringId, b.offeringId),
              eq(offeringResources.resourceId, input.resourceId),
            ),
          );
        if (!link) {
          throw new PanelError("RESOURCE_MISMATCH", "Esse profissional não faz este serviço");
        }
      }

      const duration = b.period.end.getTime() - b.period.start.getTime();
      const end = new Date(input.start.getTime() + duration);
      if (!(await withinWorkingHours(tx, input.resourceId, input.start, end))) {
        throw new PanelError("OUTSIDE_HOURS", "Fora do expediente");
      }

      try {
        const [updated] = await tx
          .update(bookings)
          .set({
            resourceId: input.resourceId,
            period: { start: input.start, end },
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, b.id))
          .returning();
        return updated;
      } catch (e) {
        if (isExclusion(e))
          throw new PanelError("CONFLICT", "Já existe um agendamento nesse horário");
        throw e;
      }
    },
    actor.userId,
  );
}

export { canTransition } from "./status";

/**
 * Concluir, marcar falta, cancelar, confirmar (pagou no local) ou desfazer.
 * Falta mexe no contador de faltas do cliente no tenant.
 */
export async function setBookingStatus(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: { bookingId: string; status: BookingStatus },
  now = new Date(),
) {
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const [b] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .for("update");
      if (!b) throw new PanelError("NOT_FOUND", "Agendamento não encontrado");
      assertCanManage(actor, b.resourceId);
      if (!canTransition(b.status, input.status)) {
        throw new PanelError("INVALID_TRANSITION", "Essa mudança de status não é permitida");
      }
      if ((input.status === "COMPLETED" || input.status === "NO_SHOW") && b.period.start > now) {
        throw new PanelError("NOT_STARTED", "O atendimento ainda não começou");
      }

      try {
        await tx
          .update(bookings)
          .set({
            status: input.status,
            updatedAt: now,
            ...(input.status === "CANCELLED" ? { cancelledAt: now, cancelReason: "TENANT" } : {}),
            ...(input.status === "CONFIRMED" ? { expiresAt: null } : {}),
          })
          .where(eq(bookings.id, b.id));
      } catch (e) {
        // Desfazer "concluído/falta" pode bater com um encaixe feito depois.
        if (isExclusion(e))
          throw new PanelError("CONFLICT", "O horário já foi ocupado por outro agendamento");
        throw e;
      }

      const delta = (input.status === "NO_SHOW" ? 1 : 0) - (b.status === "NO_SHOW" ? 1 : 0);
      if (delta !== 0) {
        await tx
          .update(customerProfiles)
          .set({
            noShowCount: sql`greatest(0, ${customerProfiles.noShowCount} + ${delta})`,
            updatedAt: now,
          })
          .where(eq(customerProfiles.id, b.customerProfileId));
      }
    },
    actor.userId,
  );
}

export interface PanelBookingInput {
  offeringId: string;
  resourceId: string;
  start: Date;
  customer: { profileId: string } | { name: string; phone?: string | null };
}

/** "Novo agendamento" no painel: cliente da casa ou de balcão (sem conta). */
export async function createPanelBooking(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: PanelBookingInput,
  now = new Date(),
) {
  assertCanManage(actor, input.resourceId);
  const [loc] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ timezone: locations.timezone })
      .from(resources)
      .innerJoin(locations, eq(locations.id, resources.locationId))
      .where(eq(resources.id, input.resourceId)),
  );
  if (!loc) throw new PanelError("NOT_FOUND", "Profissional ou espaço não encontrado");

  const { slots } = await getAvailableSlots(db, tenantId, {
    offeringId: input.offeringId,
    resourceId: input.resourceId,
    date: localParts(input.start, loc.timezone).date,
    now,
    stepMinutes: 15,
  }).catch(() => {
    throw new PanelError("SLOT_UNAVAILABLE", "Serviço ou profissional inválido");
  });
  const slot = slots.find((s) => s.start.getTime() === input.start.getTime());
  if (!slot?.available) throw new PanelError("SLOT_UNAVAILABLE", "Horário indisponível");

  try {
    return await withTenant(
      db,
      tenantId,
      async (tx) => {
        let profileId: string;
        if ("profileId" in input.customer) {
          const [p] = await tx
            .select({ id: customerProfiles.id })
            .from(customerProfiles)
            .where(eq(customerProfiles.id, input.customer.profileId));
          if (!p) throw new PanelError("NOT_FOUND", "Cliente não encontrado");
          profileId = p.id;
        } else {
          const [p] = await tx
            .insert(customerProfiles)
            .values({
              tenantId,
              name: input.customer.name.trim(),
              phone: input.customer.phone?.trim() || null,
            })
            .returning({ id: customerProfiles.id });
          profileId = p.id;
        }
        const [profile] = await tx
          .select({ userId: customerProfiles.userId })
          .from(customerProfiles)
          .where(eq(customerProfiles.id, profileId));
        const [row] = await tx
          .insert(bookings)
          .values({
            tenantId,
            customerProfileId: profileId,
            customerId: profile.userId,
            resourceId: input.resourceId,
            offeringId: input.offeringId,
            period: { start: slot.start, end: slot.end },
            status: "CONFIRMED",
            priceCents: slot.priceCents,
            source: "PANEL",
            createdByUserId: actor.userId,
          })
          .returning();
        return row;
      },
      actor.userId,
    );
  } catch (e) {
    if (isExclusion(e)) throw new PanelError("CONFLICT", "Esse horário acabou de ser ocupado");
    throw e;
  }
}

/** Bloqueio de horário (almoço, consulta, folga) na agenda de um recurso. */
export async function blockTime(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: { resourceId: string; start: Date; end: Date; reason: string | null },
) {
  assertCanManage(actor, input.resourceId);
  if (!(input.end > input.start)) throw new PanelError("INVALID_INPUT", "Fim antes do início");
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const [r] = await tx
        .select({ locationId: resources.locationId })
        .from(resources)
        .where(eq(resources.id, input.resourceId));
      if (!r) throw new PanelError("NOT_FOUND", "Profissional ou espaço não encontrado");
      const clash = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.resourceId, input.resourceId),
            inArray(bookings.status, ["CONFIRMED", "PENDING_PAYMENT"]),
            sql`${bookings.period} && tstzrange(${input.start.toISOString()}::timestamptz, ${input.end.toISOString()}::timestamptz)`,
          ),
        )
        .limit(1);
      if (clash.length) {
        throw new PanelError(
          "CONFLICT",
          "Há agendamentos nesse período. Remarque ou cancele antes.",
        );
      }
      const [row] = await tx
        .insert(availabilityExceptions)
        .values({
          tenantId,
          locationId: r.locationId,
          resourceId: input.resourceId,
          kind: "CLOSED",
          period: { start: input.start, end: input.end },
          reason: input.reason?.trim() || null,
        })
        .returning();
      return row;
    },
    actor.userId,
  );
}

export async function removeBlock(db: Db, tenantId: string, actor: Actor, blockId: string) {
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const [x] = await tx
        .select()
        .from(availabilityExceptions)
        .where(eq(availabilityExceptions.id, blockId));
      if (!x) throw new PanelError("NOT_FOUND", "Bloqueio não encontrado");
      // Bloqueio da unidade inteira só OWNER/MANAGER removem.
      if (x.resourceId) assertCanManage(actor, x.resourceId);
      else if (actor.membership.role === "STAFF") {
        throw new PanelError("FORBIDDEN", "Só gerente ou dono remove bloqueios da unidade");
      }
      await tx.delete(availabilityExceptions).where(eq(availabilityExceptions.id, blockId));
    },
    actor.userId,
  );
}
