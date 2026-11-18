/**
 * Etapa 5: serviço de reserva, expiração de pendentes, cancelamento, mensalista
 * e worker (com Redis real).
 * Fixture: R1 e R2 trabalham segunda 09–18 (São Paulo); oferta "Corte" 30 min, R$ 45.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Queue } from "bullmq";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { zonedTime, type LocalDate } from "@/lib/time";
import {
  BookingError,
  cancelBookingByCustomer,
  createBooking,
  createRecurringBooking,
  expireBooking,
  getCustomerBooking,
  listMyBookings,
  sweepExpiredBookings,
  type Customer,
} from "@/modules/booking";
import { redisConnection } from "@/modules/booking/queue";
import { startBookingWorker } from "@/modules/booking/worker";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, type TenantFixture } from "./fixtures";

const SP = "America/Sao_Paulo";
const NOW = new Date("2029-12-01T12:00:00Z");
const monday = (week: number): LocalDate => {
  const d = new Date(Date.UTC(2030, 0, 14 + week * 7, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const at = (week: number, hhmm: string) => zonedTime(monday(week), hhmm, SP);

let db: Db;
let pool: Pool;
let T: TenantFixture;
let alice: Customer;
let bob: Customer;

async function newCustomer(name: string): Promise<Customer> {
  const [u] = await db
    .insert(s.users)
    .values({ name, email: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@teste.dev` })
    .returning();
  return { id: u.id, name: u.name, email: u.email };
}

async function setOffering(values: Partial<typeof s.offerings.$inferInsert>) {
  await withTenant(db, T.tenantId, (tx) =>
    tx.update(s.offerings).set(values).where(eq(s.offerings.id, T.offeringId)),
  );
}

async function bookingRow(id: string) {
  const [b] = await withTenant(db, T.tenantId, (tx) =>
    tx.select().from(s.bookings).where(eq(s.bookings.id, id)),
  );
  return b;
}

const book = (
  customer: Customer,
  start: Date,
  resourceId: string | null,
  extra: { now?: Date; onPending?: () => Promise<void> } = {},
) =>
  createBooking(
    db,
    T.tenantId,
    customer,
    { offeringId: T.offeringId, resourceId, start, source: "TENANT_PAGE" },
    { now: () => extra.now ?? NOW, onPending: extra.onPending },
  );

const code = (e: unknown) => (e instanceof BookingError ? e.code : `não é BookingError: ${e}`);

beforeAll(async () => {
  ({ db, pool } = appDb(30));
  T = await createTenantFixture(db);
  await withTenant(db, T.tenantId, (tx) =>
    tx.insert(s.availabilityRules).values({
      tenantId: T.tenantId,
      resourceId: T.resourceIds[1],
      weekday: 1,
      startTime: "09:00",
      endTime: "18:00",
    }),
  );
  alice = await newCustomer("Alice");
  bob = await newCustomer("Bob");
});
afterAll(() => pool.end());

describe("createBooking", () => {
  it("pagamento no local: confirma na hora, sem valor online, e cria o perfil do cliente no tenant", async () => {
    const onPending = vi.fn(async () => {});
    const b = await book(alice, at(0, "10:00"), T.resourceIds[0], { onPending });
    expect(b).toMatchObject({
      status: "CONFIRMED",
      priceCents: 4500,
      prepaidCents: 0,
      expiresAt: null,
    });
    expect(onPending).not.toHaveBeenCalled();

    const row = await bookingRow(b.id);
    expect(row.customerId).toBe(alice.id);
    const [profile] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.customerProfiles).where(eq(s.customerProfiles.userId, alice.id)),
    );
    expect(profile).toMatchObject({ name: "Alice", email: alice.email });
  });

  it("o mesmo horário do mesmo profissional não pode ser reservado de novo", async () => {
    await book(alice, at(0, "11:00"), T.resourceIds[0]);
    const err = await book(bob, at(0, "11:00"), T.resourceIds[0]).catch((e) => e);
    expect(code(err)).toBe("SLOT_UNAVAILABLE");
  });

  it("horário fora da grade ou da jornada é recusado", async () => {
    expect(code(await book(alice, at(0, "10:10"), null).catch((e) => e))).toBe("SLOT_UNAVAILABLE");
    expect(code(await book(alice, at(0, "19:00"), null).catch((e) => e))).toBe("SLOT_UNAVAILABLE");
  });

  it("2 clientes ao mesmo tempo no mesmo profissional e horário: exatamente 1 consegue", async () => {
    const results = await Promise.allSettled([
      book(alice, at(1, "10:00"), T.resourceIds[0]),
      book(bob, at(1, "10:00"), T.resourceIds[0]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(["SLOT_TAKEN", "SLOT_UNAVAILABLE"]).toContain(code(rejected.reason));
  });

  it("'Qualquer': 2 clientes ao mesmo tempo ficam com profissionais diferentes; o 3º não consegue", async () => {
    const results = await Promise.allSettled([
      book(alice, at(2, "10:00"), null),
      book(bob, at(2, "10:00"), null),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((b) => b.resourceId))).toEqual(new Set(T.resourceIds));

    const carol = await newCustomer("Carol");
    expect(code(await book(carol, at(2, "10:00"), null).catch((e) => e))).toBe("SLOT_UNAVAILABLE");
  });

  it("sinal de 50%: fica pendente por 10 min e agenda a expiração", async () => {
    await setOffering({ paymentPolicy: "DEPOSIT", depositBps: 5000 });
    try {
      const onPending = vi.fn(async () => {});
      const b = await book(alice, at(3, "10:00"), T.resourceIds[0], { onPending });
      expect(b).toMatchObject({ status: "PENDING_PAYMENT", priceCents: 4500, prepaidCents: 2250 });
      expect(b.expiresAt!.getTime() - NOW.getTime()).toBe(10 * 60_000);
      expect(onPending).toHaveBeenCalledWith({
        tenantId: T.tenantId,
        bookingId: b.id,
        expiresAt: b.expiresAt,
      });
    } finally {
      await setOffering({ paymentPolicy: "ON_SITE" });
    }
  });

  it("pendência vencida não segura o horário: o próximo cliente consegue e a antiga é cancelada", async () => {
    await setOffering({ paymentPolicy: "FULL" });
    try {
      const first = await book(alice, at(4, "10:00"), T.resourceIds[0]);
      expect(first.status).toBe("PENDING_PAYMENT");

      // 5 min depois: ainda segura.
      const early = await book(bob, at(4, "10:00"), T.resourceIds[0], {
        now: new Date(NOW.getTime() + 5 * 60_000),
      }).catch((e) => e);
      expect(code(early)).toBe("SLOT_UNAVAILABLE");

      // 11 min depois: liberou.
      const second = await book(bob, at(4, "10:00"), T.resourceIds[0], {
        now: new Date(NOW.getTime() + 11 * 60_000),
      });
      expect(second.status).toBe("PENDING_PAYMENT");
      expect(await bookingRow(first.id)).toMatchObject({
        status: "CANCELLED",
        cancelReason: "PAYMENT_EXPIRED",
      });
    } finally {
      await setOffering({ paymentPolicy: "ON_SITE" });
    }
  });
});

describe("expiração", () => {
  it("expireBooking só cancela se estiver pendente e vencida", async () => {
    await setOffering({ paymentPolicy: "FULL" });
    try {
      const b = await book(alice, at(5, "10:00"), T.resourceIds[0]);
      expect(await expireBooking(db, T.tenantId, b.id, new Date(NOW.getTime() + 60_000))).toBe(
        false,
      );
      expect(await expireBooking(db, T.tenantId, b.id, new Date(NOW.getTime() + 10 * 60_000))).toBe(
        true,
      );
      expect((await bookingRow(b.id)).status).toBe("CANCELLED");
      // Idempotente.
      expect(await expireBooking(db, T.tenantId, b.id, new Date(NOW.getTime() + 20 * 60_000))).toBe(
        false,
      );
    } finally {
      await setOffering({ paymentPolicy: "ON_SITE" });
    }
  });

  it("confirmada nunca é expirada pelo job", async () => {
    const b = await book(alice, at(5, "11:00"), T.resourceIds[0]);
    expect(await expireBooking(db, T.tenantId, b.id, new Date("2031-01-01T00:00:00Z"))).toBe(false);
    expect((await bookingRow(b.id)).status).toBe("CONFIRMED");
  });

  it("a varredura de segurança expira pendências de TODOS os tenants, sem contexto de tenant", async () => {
    const other = await createTenantFixture(db);
    const pendingIn = async (tenant: TenantFixture) => {
      const [row] = await withTenant(db, tenant.tenantId, (tx) =>
        tx
          .insert(s.bookings)
          .values({
            tenantId: tenant.tenantId,
            customerProfileId: tenant.customerProfileId,
            resourceId: tenant.resourceIds[1],
            offeringId: tenant.offeringId,
            period: { start: at(6, "15:00"), end: at(6, "15:30") },
            status: "PENDING_PAYMENT",
            priceCents: 4500,
            prepaidCents: 4500,
            source: "TENANT_PAGE",
            expiresAt: new Date("2029-12-01T12:10:00Z"),
          })
          .returning({ id: s.bookings.id }),
      );
      return row.id;
    };
    const a = await pendingIn(T);
    const b = await pendingIn(other);

    const swept = await sweepExpiredBookings(db, new Date("2029-12-01T12:30:00Z"));
    const ids = swept.map((x) => x.booking_id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    expect(swept.find((x) => x.booking_id === b)!.tenant_id).toBe(other.tenantId);
    expect((await bookingRow(a)).status).toBe("CANCELLED");
  });

  it("worker real (BullMQ + Redis): o job de expiração cancela a reserva", async () => {
    await setOffering({ paymentPolicy: "FULL" });
    const queueName = `booking-test-${randomUUID().slice(0, 8)}`;
    const worker = await startBookingWorker(db, { queueName, sweepEveryMs: 3_600_000 });
    const queue = new Queue(queueName, { connection: redisConnection() });
    try {
      // Pendência criada "no passado", já vencida agora.
      const b = await book(alice, at(7, "10:00"), T.resourceIds[0], {
        now: new Date(Date.now() - 20 * 60_000),
      });
      await queue.add("expire-booking", { tenantId: T.tenantId, bookingId: b.id });
      await vi.waitFor(async () => expect((await bookingRow(b.id)).status).toBe("CANCELLED"), {
        timeout: 10_000,
        interval: 200,
      });
    } finally {
      await setOffering({ paymentPolicy: "ON_SITE" });
      await queue.obliterate({ force: true });
      await queue.close();
      await worker.close();
    }
  });
});

describe("cancelamento pelo cliente", () => {
  it("cancela com mais de 2h de antecedência", async () => {
    const b = await book(bob, at(8, "10:00"), T.resourceIds[0]);
    await cancelBookingByCustomer(db, T.tenantId, bob.id, b.id, { now: () => NOW });
    expect(await bookingRow(b.id)).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER" });
  });

  it("dentro das 2h finais não cancela pelo app", async () => {
    const b = await book(bob, at(8, "11:00"), T.resourceIds[0]);
    const err = await cancelBookingByCustomer(db, T.tenantId, bob.id, b.id, {
      now: () => new Date(at(8, "09:30").getTime()),
    }).catch((e) => e);
    expect(code(err)).toBe("CANCEL_WINDOW_CLOSED");
  });

  it("não cancela reserva de outra pessoa nem uma já cancelada", async () => {
    const b = await book(bob, at(8, "12:00"), T.resourceIds[0]);
    expect(
      code(await cancelBookingByCustomer(db, T.tenantId, alice.id, b.id).catch((e) => e)),
    ).toBe("NOT_FOUND");
    await cancelBookingByCustomer(db, T.tenantId, bob.id, b.id, { now: () => NOW });
    expect(
      code(
        await cancelBookingByCustomer(db, T.tenantId, bob.id, b.id, { now: () => NOW }).catch(
          (e) => e,
        ),
      ),
    ).toBe("NOT_CANCELLABLE");
  });
});

describe("mensalista", () => {
  const recurring = (customer: Customer, start: Date, now = NOW) =>
    createRecurringBooking(
      db,
      T.tenantId,
      customer,
      { offeringId: T.offeringId, resourceId: T.resourceIds[1], start, source: "TENANT_PAGE" },
      { now: () => now },
    );

  it("serviço que não aceita mensalista é recusado", async () => {
    await setOffering({ allowRecurring: false });
    expect(code(await recurring(alice, at(10, "16:00")).catch((e) => e))).toBe(
      "RECURRING_NOT_ALLOWED",
    );
  });

  it("reserva 4 semanas no mesmo dia e hora, tudo pendente até o pagamento mensal", async () => {
    await setOffering({ allowRecurring: true });
    const r = await recurring(alice, at(10, "16:00"));
    expect(r.bookingIds).toHaveLength(4);
    expect(r.monthlyPriceCents).toBe(4 * 4500);
    const rows = await Promise.all(r.bookingIds.map(bookingRow));
    expect(rows.map((b) => b.period.start.toISOString())).toEqual(
      [10, 11, 12, 13].map((w) => at(w, "16:00").toISOString()),
    );
    expect(rows.every((b) => b.status === "PENDING_PAYMENT" && b.recurringBookingId)).toBe(true);
  });

  it("se alguma semana estiver ocupada, nada é criado e as datas em conflito voltam no erro", async () => {
    await book(bob, at(16, "16:00"), T.resourceIds[1]);
    const err = await recurring(alice, at(14, "16:00")).catch((e) => e);
    expect(code(err)).toBe("RECURRING_CONFLICT");
    expect((err as BookingError).details).toEqual({ conflicts: ["2030-05-06"] });
    const created = await withTenant(db, T.tenantId, (tx) =>
      tx
        .select()
        .from(s.bookings)
        .where(
          and(eq(s.bookings.customerId, alice.id), eq(s.bookings.resourceId, T.resourceIds[1])),
        ),
    );
    expect(created.some((b) => b.period.start.getTime() === at(14, "16:00").getTime())).toBe(false);
  });

  it("se o primeiro pagamento expirar, o mensalista inteiro é cancelado", async () => {
    const r = await recurring(bob, at(20, "17:00"));
    const swept = await sweepExpiredBookings(db, new Date(NOW.getTime() + 11 * 60_000));
    expect(swept.map((x) => x.booking_id)).toEqual(expect.arrayContaining(r.bookingIds));
    const [rec] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.recurringBookings).where(eq(s.recurringBookings.id, r.recurringId)),
    );
    expect(rec.status).toBe("CANCELLED");
  });
});

describe("visão do cliente", () => {
  it("'Meus agendamentos' traz nome do estabelecimento e do serviço, em todos os tenants", async () => {
    const dave = await newCustomer("Dave");
    const b = await book(dave, at(30, "10:00"), T.resourceIds[0]);
    const mine = await listMyBookings(db, dave.id);
    expect(mine).toEqual([
      expect.objectContaining({
        id: b.id,
        offeringName: "Corte",
        resourceName: "R1",
        status: "CONFIRMED",
      }),
    ]);
    expect(mine[0].tenantName).toMatch(/^Tenant /);
    expect(await listMyBookings(db, alice.id)).not.toContainEqual(
      expect.objectContaining({ id: b.id }),
    );
  });

  it("detalhe da reserva só para o dono dela", async () => {
    const erin = await newCustomer("Erin");
    const b = await book(erin, at(31, "10:00"), T.resourceIds[0]);
    const mine = await getCustomerBooking(db, T.tenantId, erin.id, b.id);
    expect(mine).toMatchObject({ id: b.id, offeringName: "Corte", timezone: SP, recurring: false });
    expect(await getCustomerBooking(db, T.tenantId, alice.id, b.id)).toBeNull();
  });
});
