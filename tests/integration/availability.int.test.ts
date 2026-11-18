/**
 * Etapa 4: getAvailableSlots contra o banco real.
 * Fixture: R1 trabalha seg 09–18 (São Paulo) e tem um booking seg 07/01/2030 09:00–09:30.
 */
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { zonedTime } from "@/lib/time";
import { AvailabilityError, getAvailableSlots } from "@/modules/scheduling";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, pgCode, type TenantFixture } from "./fixtures";

const MONDAY = "2030-01-07";
const NOW = new Date("2029-12-01T00:00:00Z");
const SP = "America/Sao_Paulo";
const mon = { year: 2030, month: 1, day: 7 };

let db: Db;
let pool: Pool;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  ({ db, pool } = appDb());
  A = await createTenantFixture(db);
  B = await createTenantFixture(db);
});
afterAll(() => pool.end());

const query = (extra: Partial<Parameters<typeof getAvailableSlots>[2]> = {}) =>
  getAvailableSlots(db, A.tenantId, { offeringId: A.offeringId, date: MONDAY, now: NOW, ...extra });

describe("getAvailableSlots", () => {
  it("considera a jornada e o booking existente", async () => {
    const { slots, timezone } = await query({ resourceId: A.resourceIds[0] });
    expect(timezone).toBe(SP);
    const by = (t: string) => slots.find((x) => x.localTime === t)!;
    expect(slots[0].localTime).toBe("09:00");
    expect(slots.at(-1)!.localTime).toBe("17:30");
    expect(by("09:00").available).toBe(false);
    expect(by("09:30").available).toBe(true);
  });

  it("dia sem jornada devolve lista vazia", async () => {
    const { slots } = await query({ date: "2030-01-08" }); // terça
    expect(slots).toEqual([]);
  });

  it("'Qualquer': quando o segundo profissional passa a trabalhar, 09:00 volta a ficar livre com ele", async () => {
    await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.availabilityRules).values({
        tenantId: A.tenantId,
        resourceId: A.resourceIds[1],
        weekday: 1,
        startTime: "09:00",
        endTime: "21:00",
      }),
    );
    const { slots, resources } = await query();
    expect(resources.map((r) => r.id).sort()).toEqual([...A.resourceIds].sort());
    const nine = slots.find((x) => x.localTime === "09:00")!;
    expect(nine.available).toBe(true);
    expect(nine.resourceId).toBe(A.resourceIds[1]);
    // R2 vai até 21h, então existem horários depois das 18h.
    expect(slots.at(-1)!.localTime).toBe("20:30");
  });

  it("aplica a regra de preço da oferta (18–21h)", async () => {
    const { slots } = await query({ resourceId: A.resourceIds[1] });
    expect(slots.find((x) => x.localTime === "17:30")!.priceCents).toBe(4500);
    expect(slots.find((x) => x.localTime === "18:00")!.priceCents).toBe(5000);
  });

  it("exceção CLOSED da Location fecha todos os recursos", async () => {
    const [ex] = await withTenant(db, A.tenantId, (tx) =>
      tx
        .insert(s.availabilityExceptions)
        .values({
          tenantId: A.tenantId,
          locationId: A.locationId,
          kind: "CLOSED",
          period: { start: zonedTime(mon, "12:00", SP), end: zonedTime(mon, "14:00", SP) },
        })
        .returning(),
    );
    const { slots } = await query();
    expect(slots.some((x) => x.localTime >= "12:00" && x.localTime < "14:00")).toBe(false);
    await withTenant(db, A.tenantId, (tx) =>
      tx.delete(s.availabilityExceptions).where(eq(s.availabilityExceptions.id, ex.id)),
    );
  });

  it("o que o motor diz que está livre o banco aceita, e o que diz que está ocupado o banco recusa", async () => {
    const before = await query({ resourceId: A.resourceIds[0] });
    const free = before.slots.find((x) => x.available)!;
    const insert = (start: Date, end: Date) =>
      withTenant(db, A.tenantId, (tx) =>
        tx.insert(s.bookings).values({
          tenantId: A.tenantId,
          customerProfileId: A.customerProfileId,
          resourceId: A.resourceIds[0],
          offeringId: A.offeringId,
          period: { start, end },
          priceCents: free.priceCents,
          source: "TENANT_PAGE",
        }),
      );

    await insert(free.start, free.end);
    const after = await query({ resourceId: A.resourceIds[0] });
    expect(after.slots.find((x) => x.localTime === free.localTime)!.available).toBe(false);

    const taken = after.slots.filter((x) => !x.available);
    for (const t of taken) {
      expect(pgCode(await insert(t.start, t.end).catch((e) => e))).toBe("23P01");
    }
  });

  it("booking cancelado não ocupa", async () => {
    await withTenant(db, A.tenantId, (tx) =>
      tx.update(s.bookings).set({ status: "CANCELLED" }).where(eq(s.bookings.id, A.bookingId)),
    );
    const { slots } = await query({ resourceId: A.resourceIds[0] });
    expect(slots.find((x) => x.localTime === "09:00")!.available).toBe(true);
  });

  it("oferta de outro tenant não é encontrada (RLS)", async () => {
    const err = await getAvailableSlots(db, A.tenantId, {
      offeringId: B.offeringId,
      date: MONDAY,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AvailabilityError);
    expect(err.code).toBe("OFFERING_NOT_FOUND");
  });

  it("recurso que não executa a oferta é recusado", async () => {
    const err = await query({ resourceId: B.resourceIds[0] }).catch((e) => e);
    expect(err.code).toBe("RESOURCE_NOT_FOUND");
  });

  it.each(["2030-02-30", "07/01/2030", "amanhã"])("data inválida %s é recusada", async (date) => {
    const err = await query({ date }).catch((e) => e);
    expect(err.code).toBe("INVALID_DATE");
  });
});
