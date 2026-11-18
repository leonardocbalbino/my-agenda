/**
 * Critério de aceite: dois bookings simultâneos no mesmo recurso e horário
 * resultam em EXATAMENTE 1 sucesso. Garantido pela exclusion constraint
 * bookings_no_overlap, não por checagem na aplicação.
 */
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Period } from "@/db/custom-types";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, pgCode, slotAt, type TenantFixture } from "./fixtures";

type Status = (typeof s.bookings.$inferInsert)["status"];

let db: Db;
let pool: Pool;
let T: TenantFixture;
// Cada teste usa um dia diferente a partir daqui, para não interferirem entre si.
const BASE = new Date("2032-03-01T12:00:00Z");
let day = 0;
const nextDay = () => new Date(BASE.getTime() + day++ * 24 * 60 * 60_000);

beforeAll(async () => {
  ({ db, pool } = appDb(30));
  T = await createTenantFixture(db);
});
afterAll(() => pool.end());

function book(period: Period, opts: { resource?: 0 | 1; status?: Status } = {}) {
  const status = opts.status ?? "CONFIRMED";
  return withTenant(db, T.tenantId, (tx) =>
    tx
      .insert(s.bookings)
      .values({
        tenantId: T.tenantId,
        customerProfileId: T.customerProfileId,
        resourceId: T.resourceIds[opts.resource ?? 0],
        offeringId: T.offeringId,
        period,
        status,
        priceCents: 4500,
        source: "TENANT_PAGE",
        expiresAt: status === "PENDING_PAYMENT" ? new Date(Date.now() + 10 * 60_000) : null,
      })
      .returning({ id: s.bookings.id }),
  );
}

/**
 * Dispara N reservas em transações separadas que só fazem o INSERT depois que
 * TODAS já abriram e definiram o contexto: concorrência real, não sequencial.
 */
async function raceBookings(periods: Period[]) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return Promise.allSettled(
    periods.map((period) =>
      withTenant(db, T.tenantId, async (tx) => {
        if (++arrived === periods.length) release();
        await gate;
        return tx
          .insert(s.bookings)
          .values({
            tenantId: T.tenantId,
            customerProfileId: T.customerProfileId,
            resourceId: T.resourceIds[0],
            offeringId: T.offeringId,
            period,
            priceCents: 4500,
            source: "MARKETPLACE",
          })
          .returning({ id: s.bookings.id });
      }),
    ),
  );
}

describe("anti double-booking", () => {
  it("2 reservas simultâneas no mesmo recurso e horário: exatamente 1 sucesso", async () => {
    const period = slotAt(nextDay(), 0);
    const results = await raceBookings([period, period]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(pgCode(failed[0].reason)).toBe("23P01"); // exclusion_violation
  });

  it("20 reservas simultâneas sobrepostas (horários diferentes): exatamente 1 sucesso", async () => {
    const base = nextDay();
    // Todas cruzam o intervalo 10:00–10:15 relativo à base.
    const periods = Array.from({ length: 20 }, (_, i) => slotAt(base, 0, 30 + i * 5));
    const results = await raceBookings(periods);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const codes = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => pgCode(r.reason));
    expect(new Set(codes)).toEqual(new Set(["23P01"]));
  });

  it("horários encostados [18:00,18:30) e [18:30,19:00) não conflitam", async () => {
    const base = nextDay();
    await book(slotAt(base, 0, 30));
    await expect(book(slotAt(base, 0.5, 30))).resolves.toHaveLength(1);
  });

  it("mesmo horário em recursos diferentes não conflita", async () => {
    const period = slotAt(nextDay(), 0);
    await book(period, { resource: 0 });
    await expect(book(period, { resource: 1 })).resolves.toHaveLength(1);
  });

  it("PENDING_PAYMENT também segura o horário", async () => {
    const period = slotAt(nextDay(), 0);
    await book(period, { status: "PENDING_PAYMENT" });
    expect(pgCode(await book(period).catch((e) => e))).toBe("23P01");
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW"] as const)(
    "booking %s não bloqueia o horário",
    async (status) => {
      const period = slotAt(nextDay(), 0);
      await book(period, { status });
      await expect(book(period)).resolves.toHaveLength(1);
    },
  );

  it("reativar um booking cancelado num horário já ocupado falha", async () => {
    const period = slotAt(nextDay(), 0);
    const [cancelled] = await book(period, { status: "CANCELLED" });
    await book(period);
    const err = await withTenant(db, T.tenantId, (tx) =>
      tx.execute(sql`update bookings set status = 'CONFIRMED' where id = ${cancelled.id}`),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
  });
});

describe("checks do booking", () => {
  it("PENDING_PAYMENT sem expires_at é rejeitado", async () => {
    const err = await withTenant(db, T.tenantId, (tx) =>
      tx.execute(sql`
        insert into bookings (tenant_id, customer_profile_id, resource_id, offering_id, period,
                              status, price_cents, source)
        values (${T.tenantId}, ${T.customerProfileId}, ${T.resourceIds[0]}, ${T.offeringId},
                tstzrange(now() + interval '400 days', now() + interval '400 days 1 hour'),
                'PENDING_PAYMENT', 4500, 'PANEL')`),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("23514"); // check_violation
  });

  it.each([
    ["vazio", "tstzrange(now(), now())"],
    ["aberto no fim", "tstzrange(now(), null)"],
    ["fechado no fim", "tstzrange(now(), now() + interval '1 hour', '[]')"],
  ])("período %s é rejeitado", async (_, range) => {
    const err = await withTenant(db, T.tenantId, (tx) =>
      tx.execute(
        sql`insert into bookings (tenant_id, customer_profile_id, resource_id, offering_id, period,
                                  price_cents, source)
            values (${T.tenantId}, ${T.customerProfileId}, ${T.resourceIds[1]}, ${T.offeringId},
                    ${sql.raw(range)}, 4500, 'PANEL')`,
      ),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("23514");
  });
});
