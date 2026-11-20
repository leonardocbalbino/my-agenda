/**
 * Etapa 9: busca do marketplace (vitrine pública + PostGIS) e próximos horários livres.
 * O banco de teste é compartilhado: as asserções olham só os tenants criados aqui.
 */
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { nextFreeSlots, searchListings, slotPath, type Listing } from "@/modules/marketplace";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, type TenantFixture } from "./fixtures";

let db: Db;
let pool: Pool;
let near: TenantFixture; // ~1 km do ponto de busca
let far: TenantFixture; // ~30 km
let hidden: TenantFixture; // não listado
let salon: TenantFixture; // nicho SALON, "Salão Bela Vista"
const ME = { lat: -23.55, lng: -46.63 };

async function setTenant(t: TenantFixture, values: Partial<typeof s.tenants.$inferInsert>) {
  await withTenant(db, t.tenantId, (tx) =>
    tx.update(s.tenants).set(values).where(eq(s.tenants.id, t.tenantId)),
  );
}
async function setPlace(t: TenantFixture, lng: number, lat: number, neighborhood: string) {
  await withTenant(db, t.tenantId, (tx) =>
    tx
      .update(s.locations)
      .set({ geo: { lng, lat }, neighborhood })
      .where(eq(s.locations.id, t.locationId)),
  );
}
const ids = (list: Listing[]) => list.map((l) => l.tenantId).filter((id) => mine.includes(id));
let mine: string[] = [];

beforeAll(async () => {
  ({ db, pool } = appDb(10));
  near = await createTenantFixture(db, { listed: true });
  far = await createTenantFixture(db, { listed: true });
  hidden = await createTenantFixture(db, { listed: false });
  salon = await createTenantFixture(db, { listed: true });
  mine = [near, far, hidden, salon].map((t) => t.tenantId);
  await setPlace(near, -46.639, -23.55, "Consolação");
  await setPlace(far, -46.92, -23.6, "Cotia Centro");
  await setPlace(hidden, -46.631, -23.55, "Sé");
  await setPlace(salon, -46.65, -23.555, "Bela Vista");
  await setTenant(salon, { niche: "SALON", name: "Salão Bela Vista" });
});
afterAll(() => pool.end());

describe("searchListings", () => {
  it("só mostra tenants listados, do mais perto para o mais longe, com distância", async () => {
    const list = await searchListings(db, { ...ME, radiusKm: 50 });
    expect(ids(list)).toEqual([near.tenantId, salon.tenantId, far.tenantId]);
    const n = list.find((l) => l.tenantId === near.tenantId)!;
    expect(n.distanceMeters).toBeGreaterThan(800);
    expect(n.distanceMeters).toBeLessThan(1_200);
    expect(n.headlineOfferingId).toBe(near.offeringId);
    expect(n.offeringNames).toEqual(["Corte"]);
  });

  it("o raio corta quem está longe", async () => {
    expect(ids(await searchListings(db, { ...ME, radiusKm: 10 }))).toEqual([
      near.tenantId,
      salon.tenantId,
    ]);
  });

  it("suspenso some da vitrine", async () => {
    await setTenant(far, { status: "SUSPENDED" });
    expect(ids(await searchListings(db, { ...ME, radiusKm: 50 }))).not.toContain(far.tenantId);
    await setTenant(far, { status: "ACTIVE" });
  });

  it("filtra por nicho", async () => {
    expect(ids(await searchListings(db, { niche: "SALON" }))).toEqual([salon.tenantId]);
  });

  it("'O quê' acha serviço, nome e bairro, sem diferenciar acento e maiúscula", async () => {
    expect(ids(await searchListings(db, { q: "salao" }))).toEqual([salon.tenantId]);
    expect(ids(await searchListings(db, { q: "CORTE" })).sort()).toEqual(
      [near.tenantId, far.tenantId, salon.tenantId].sort(),
    );
    expect(ids(await searchListings(db, { q: "consolacao" }))).toEqual([near.tenantId]);
  });

  it("'Onde' em texto filtra por bairro ou cidade", async () => {
    expect(ids(await searchListings(db, { where: "cotia" }))).toEqual([far.tenantId]);
  });

  it("curinga digitado é texto, não 'qualquer coisa'", async () => {
    expect(ids(await searchListings(db, { q: "%" }))).toEqual([]);
    expect(ids(await searchListings(db, { q: "_" }))).toEqual([]);
  });
});

describe("nextFreeSlots", () => {
  // Fixture: R1 trabalha segunda 09–18 (SP) e tem um booking seg 07/01/2030 09:00.
  const SUNDAY_NOON = new Date("2030-01-06T15:00:00Z");

  it("domingo fechado: pula para segunda e devolve os 3 primeiros livres", async () => {
    const r = await nextFreeSlots(
      db,
      {
        tenantId: near.tenantId,
        timezone: "America/Sao_Paulo",
        headlineOfferingId: near.offeringId,
      },
      { dayOffset: 0, fromHour: null },
      SUNDAY_NOON,
    );
    expect(r?.date).toBe("2030-01-07");
    expect(r?.slots.map((x) => x.label)).toEqual(["09:30", "10:00", "10:30"]);
    expect(r?.slots[0].resourceId).toBe(near.resourceIds[0]);
  });

  it("'amanhã a partir das 14h' respeita a hora mínima", async () => {
    const r = await nextFreeSlots(
      db,
      { tenantId: far.tenantId, timezone: "America/Sao_Paulo", headlineOfferingId: far.offeringId },
      { dayOffset: 1, fromHour: 14 },
      SUNDAY_NOON,
    );
    expect(r?.slots.map((x) => x.label)).toEqual(["14:00", "14:30", "15:00"]);
  });

  it("sem serviço vitrine não há horários", async () => {
    expect(
      await nextFreeSlots(
        db,
        { tenantId: near.tenantId, timezone: "America/Sao_Paulo", headlineOfferingId: null },
        { dayOffset: 0, fromHour: null },
      ),
    ).toBeNull();
  });
});

describe("slotPath", () => {
  it("leva serviço, dia, hora, quem atende e o token de origem", () => {
    const slot = { label: "18:30", start: new Date(), resourceId: "r-1" };
    const p = new URLSearchParams(
      slotPath({ isRental: false, headlineOfferingId: "o-1" }, "2030-01-07", slot, "tok").slice(2),
    );
    expect(Object.fromEntries(p)).toEqual({
      servico: "o-1",
      dia: "2030-01-07",
      hora: "18:30",
      profissional: "r-1",
      ref: "tok",
    });
    const q = new URLSearchParams(
      slotPath({ isRental: true, headlineOfferingId: "o-2" }, "2030-01-07", slot, "tok").slice(2),
    );
    expect(q.get("quadra")).toBe("r-1");
    expect(q.has("profissional")).toBe(false);
  });
});
