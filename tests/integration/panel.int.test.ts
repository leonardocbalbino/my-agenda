/**
 * Etapa 6: regras do painel (remarcar, status, balcão, bloqueio, agenda do dia)
 * e cadastros (serviços, jornada, equipe, clientes), com os papéis.
 * Fixture: R1 e R2 trabalham segunda 09–18 (São Paulo); oferta "Corte" 30 min.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { zonedTime, type LocalDate } from "@/lib/time";
import {
  PanelError,
  blockTime,
  createPanelBooking,
  removeBlock,
  rescheduleBooking,
  setBookingStatus,
  type Actor,
} from "@/modules/booking/panel";
import {
  CatalogError,
  addMember,
  getWeeklyRules,
  listCustomers,
  removeMember,
  saveOffering,
  saveWeeklyRules,
} from "@/modules/catalog/admin";
import { getAvailableSlots } from "@/modules/scheduling";
import { getDayAgenda } from "@/modules/scheduling/agenda";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, type TenantFixture } from "./fixtures";

const SP = "America/Sao_Paulo";
const monday = (week: number): LocalDate => {
  const d = new Date(Date.UTC(2030, 2, 4 + week * 7, 12)); // 04/03/2030 é segunda
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const iso = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const at = (week: number, hhmm: string) => zonedTime(monday(week), hhmm, SP);

let db: Db;
let pool: Pool;
let T: TenantFixture;
let other: TenantFixture;
let owner: Actor;
let manager: Actor;
let staff1: Actor;
let staff2: Actor;
let R1: string;
let R2: string;

const code = (e: unknown) =>
  e instanceof PanelError || e instanceof CatalogError ? e.code : `inesperado: ${e}`;

async function seedBooking(
  resourceId: string,
  start: Date,
  minutes = 30,
  status: "CONFIRMED" | "PENDING_PAYMENT" = "CONFIRMED",
) {
  const [row] = await withTenant(db, T.tenantId, (tx) =>
    tx
      .insert(s.bookings)
      .values({
        tenantId: T.tenantId,
        customerProfileId: T.customerProfileId,
        resourceId,
        offeringId: T.offeringId,
        period: { start, end: new Date(start.getTime() + minutes * 60_000) },
        status,
        priceCents: 4500,
        prepaidCents: status === "PENDING_PAYMENT" ? 4500 : 0,
        expiresAt: status === "PENDING_PAYMENT" ? new Date("2099-01-01T00:00:00Z") : null,
        source: "TENANT_PAGE",
      })
      .returning(),
  );
  return row;
}

const booking = async (id: string) =>
  (
    await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.bookings).where(eq(s.bookings.id, id)),
    )
  )[0];

beforeAll(async () => {
  ({ db, pool } = appDb(10));
  T = await createTenantFixture(db);
  other = await createTenantFixture(db);
  [R1, R2] = T.resourceIds;
  await withTenant(db, T.tenantId, (tx) =>
    tx.insert(s.availabilityRules).values({
      tenantId: T.tenantId,
      resourceId: R2,
      weekday: 1,
      startTime: "09:00",
      endTime: "18:00",
    }),
  );
  owner = { userId: T.userId, membership: { role: "OWNER", resourceId: null } };
  manager = { userId: T.userId, membership: { role: "MANAGER", resourceId: null } };
  staff1 = { userId: T.userId, membership: { role: "STAFF", resourceId: R1 } };
  staff2 = { userId: T.userId, membership: { role: "STAFF", resourceId: R2 } };
});
afterAll(() => pool.end());

describe("remarcar (arrastar e soltar)", () => {
  it("dono move para outro horário e outro profissional, mantendo a duração", async () => {
    const b = await seedBooking(R1, at(0, "09:00"), 30);
    const moved = await rescheduleBooking(db, T.tenantId, owner, {
      bookingId: b.id,
      resourceId: R2,
      start: at(0, "10:30"),
    });
    expect(moved.resourceId).toBe(R2);
    expect(moved.period.start.toISOString()).toBe(at(0, "10:30").toISOString());
    expect(moved.period.end.toISOString()).toBe(at(0, "11:00").toISOString());
  });

  it("STAFF não mexe na agenda de outro, nem leva o próprio agendamento para outra coluna", async () => {
    const b2 = await seedBooking(R2, at(1, "09:00"));
    const err1 = await rescheduleBooking(db, T.tenantId, staff1, {
      bookingId: b2.id,
      resourceId: R2,
      start: at(1, "10:00"),
    }).catch((e) => e);
    expect(code(err1)).toBe("FORBIDDEN");
    const err2 = await rescheduleBooking(db, T.tenantId, staff2, {
      bookingId: b2.id,
      resourceId: R1,
      start: at(1, "10:00"),
    }).catch((e) => e);
    expect(code(err2)).toBe("FORBIDDEN");
    // Na própria coluna, pode.
    const ok = await rescheduleBooking(db, T.tenantId, staff2, {
      bookingId: b2.id,
      resourceId: R2,
      start: at(1, "10:00"),
    });
    expect(ok.period.start.toISOString()).toBe(at(1, "10:00").toISOString());
  });

  it("fora do expediente é recusado", async () => {
    const b = await seedBooking(R1, at(2, "09:00"));
    const err = await rescheduleBooking(db, T.tenantId, owner, {
      bookingId: b.id,
      resourceId: R1,
      start: at(2, "17:45"),
    }).catch((e) => e);
    expect(code(err)).toBe("OUTSIDE_HOURS"); // 17:45–18:15 passa das 18h
  });

  it("em cima de outro agendamento é recusado pelo banco (conflito)", async () => {
    const a = await seedBooking(R1, at(3, "09:00"));
    await seedBooking(R1, at(3, "11:00"));
    const err = await rescheduleBooking(db, T.tenantId, owner, {
      bookingId: a.id,
      resourceId: R1,
      start: at(3, "10:45"),
    }).catch((e) => e);
    expect(code(err)).toBe("CONFLICT");
    expect((await booking(a.id)).period.start.toISOString()).toBe(at(3, "09:00").toISOString());
  });

  it("para quem não faz o serviço é recusado", async () => {
    const [r3] = await withTenant(db, T.tenantId, (tx) =>
      tx
        .insert(s.resources)
        .values({
          tenantId: T.tenantId,
          locationId: T.locationId,
          kind: "PROFESSIONAL",
          name: "R3",
        })
        .returning(),
    );
    const b = await seedBooking(R1, at(4, "09:00"));
    const err = await rescheduleBooking(db, T.tenantId, owner, {
      bookingId: b.id,
      resourceId: r3.id,
      start: at(4, "10:00"),
    }).catch((e) => e);
    expect(code(err)).toBe("RESOURCE_MISMATCH");
  });

  it("agendamento de outro tenant não é encontrado", async () => {
    const err = await rescheduleBooking(db, T.tenantId, owner, {
      bookingId: other.bookingId,
      resourceId: R1,
      start: at(5, "10:00"),
    }).catch((e) => e);
    expect(code(err)).toBe("NOT_FOUND");
  });
});

describe("status pelo painel", () => {
  const past = new Date("2031-01-01T00:00:00Z");

  it("falta soma no contador do cliente; desfazer subtrai", async () => {
    const b = await seedBooking(R1, at(6, "09:00"));
    const count = async () =>
      (
        await withTenant(db, T.tenantId, (tx) =>
          tx
            .select()
            .from(s.customerProfiles)
            .where(eq(s.customerProfiles.id, T.customerProfileId)),
        )
      )[0].noShowCount;
    const before = await count();
    await setBookingStatus(db, T.tenantId, staff1, { bookingId: b.id, status: "NO_SHOW" }, past);
    expect(await count()).toBe(before + 1);
    await setBookingStatus(db, T.tenantId, staff1, { bookingId: b.id, status: "CONFIRMED" }, past);
    expect(await count()).toBe(before);
  });

  it("não conclui o que ainda não começou", async () => {
    const b = await seedBooking(R1, at(6, "10:00"));
    const err = await setBookingStatus(
      db,
      T.tenantId,
      owner,
      { bookingId: b.id, status: "COMPLETED" },
      new Date("2029-01-01T00:00:00Z"),
    ).catch((e) => e);
    expect(code(err)).toBe("NOT_STARTED");
  });

  it("transições inválidas e agenda alheia são recusadas", async () => {
    const b = await seedBooking(R1, at(6, "11:00"));
    await setBookingStatus(db, T.tenantId, owner, { bookingId: b.id, status: "CANCELLED" });
    expect((await booking(b.id)).cancelReason).toBe("TENANT");
    expect(
      code(
        await setBookingStatus(db, T.tenantId, owner, {
          bookingId: b.id,
          status: "CONFIRMED",
        }).catch((e) => e),
      ),
    ).toBe("INVALID_TRANSITION");
    const c = await seedBooking(R1, at(6, "12:00"));
    expect(
      code(
        await setBookingStatus(db, T.tenantId, staff2, {
          bookingId: c.id,
          status: "CANCELLED",
        }).catch((e) => e),
      ),
    ).toBe("FORBIDDEN");
  });

  it("confirmar manualmente uma pendência (pagou no local) tira o prazo de expiração", async () => {
    const b = await seedBooking(R1, at(6, "13:00"), 30, "PENDING_PAYMENT");
    await setBookingStatus(db, T.tenantId, owner, { bookingId: b.id, status: "CONFIRMED" });
    expect(await booking(b.id)).toMatchObject({ status: "CONFIRMED", expiresAt: null });
  });
});

describe("novo agendamento no painel e bloqueios", () => {
  const NOW = new Date("2029-12-01T12:00:00Z");

  it("cliente de balcão: cria o perfil sem conta e confirma na hora", async () => {
    const b = await createPanelBooking(
      db,
      T.tenantId,
      owner,
      {
        offeringId: T.offeringId,
        resourceId: R1,
        start: at(7, "09:15"),
        customer: { name: "Seu Zé", phone: "11999990000" },
      },
      NOW,
    );
    expect(b).toMatchObject({
      status: "CONFIRMED",
      source: "PANEL",
      priceCents: 4500,
      customerId: null,
    });
    const [p] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.customerProfiles).where(eq(s.customerProfiles.id, b.customerProfileId)),
    );
    expect(p).toMatchObject({ name: "Seu Zé", phone: "11999990000", userId: null });
  });

  it("STAFF só agenda na própria coluna; horário ocupado é recusado", async () => {
    const input = {
      offeringId: T.offeringId,
      resourceId: R2,
      start: at(7, "10:00"),
      customer: { name: "X" },
    };
    expect(code(await createPanelBooking(db, T.tenantId, staff1, input, NOW).catch((e) => e))).toBe(
      "FORBIDDEN",
    );
    await createPanelBooking(db, T.tenantId, staff2, input, NOW);
    expect(code(await createPanelBooking(db, T.tenantId, owner, input, NOW).catch((e) => e))).toBe(
      "SLOT_UNAVAILABLE",
    );
  });

  it("bloqueio tira os horários da página pública e aparece na agenda", async () => {
    const block = await blockTime(db, T.tenantId, staff1, {
      resourceId: R1,
      start: at(8, "13:00"),
      end: at(8, "14:00"),
      reason: "Almoço",
    });
    const { slots } = await getAvailableSlots(db, T.tenantId, {
      offeringId: T.offeringId,
      resourceId: R1,
      date: iso(monday(8)),
      now: NOW,
    });
    expect(slots.some((x) => x.localTime === "13:00" || x.localTime === "13:30")).toBe(false);
    const agenda = await getDayAgenda(db, T.tenantId, iso(monday(8)));
    expect(agenda.blocks).toContainEqual(
      expect.objectContaining({ id: block.id, startMin: 780, endMin: 840, reason: "Almoço" }),
    );
    await removeBlock(db, T.tenantId, staff1, block.id);
    expect((await getDayAgenda(db, T.tenantId, iso(monday(8)))).blocks).toHaveLength(0);
  });

  it("não bloqueia por cima de agendamento", async () => {
    await seedBooking(R1, at(9, "15:00"));
    const err = await blockTime(db, T.tenantId, owner, {
      resourceId: R1,
      start: at(9, "14:30"),
      end: at(9, "16:00"),
      reason: null,
    }).catch((e) => e);
    expect(code(err)).toBe("CONFLICT");
  });
});

describe("agenda do dia", () => {
  it("colunas com expediente, reservas posicionadas e indicadores; STAFF vê só a própria coluna", async () => {
    const day = monday(10);
    await seedBooking(R1, at(10, "09:00"), 60);
    await seedBooking(R2, at(10, "10:00"), 30);
    const a = await getDayAgenda(db, T.tenantId, iso(day));
    expect(a.columns.map((c) => [c.name, c.working])).toEqual([
      ["R1", [[540, 1080]]],
      ["R2", [[540, 1080]]],
      ["R3", []], // ativo, mas sem expediente no dia: coluna vazia
    ]);
    expect(a.range).toEqual({ from: 540, to: 1080 });
    expect(a.bookings.map((b) => [b.startMin, b.endMin])).toEqual([
      [540, 600],
      [600, 630],
    ]);
    expect(a.kpis).toMatchObject({ bookings: 2, forecastCents: 9000, occupancy: 8 }); // 90 de 1080 min
    expect(a.kpis.longestFree).toEqual({ from: 600, to: 1080 }); // R1 livre das 10h às 18h

    const mine = await getDayAgenda(db, T.tenantId, iso(day), { onlyResourceId: R2 });
    expect(mine.columns.map((c) => c.name)).toEqual(["R2"]);
    expect(mine.bookings).toHaveLength(1);
  });
});

describe("cadastros", () => {
  const base = {
    name: "Pezinho",
    mode: "SERVICE" as const,
    durationMinutes: 15,
    slotMinutes: null,
    basePriceCents: 1500,
    paymentPolicy: "DEPOSIT" as const,
    depositPercent: 50,
    allowRecurring: false,
    active: true,
  };

  it("cria serviço com profissionais e sinal em bps; edita depois", async () => {
    const id = await saveOffering(db, T.tenantId, manager, { ...base, resourceIds: [R1] });
    const [o] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.offerings).where(eq(s.offerings.id, id)),
    );
    expect(o).toMatchObject({
      name: "Pezinho",
      depositBps: 5000,
      basePriceCents: 1500,
      durationMinutes: 15,
    });
    await saveOffering(db, T.tenantId, owner, {
      ...base,
      id,
      basePriceCents: 2000,
      resourceIds: [R1, R2],
    });
    const links = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.offeringResources).where(eq(s.offeringResources.offeringId, id)),
    );
    expect(links.map((l) => l.resourceId).sort()).toEqual([R1, R2].sort());
  });

  it("validação devolve o campo com problema", async () => {
    const err = await saveOffering(db, T.tenantId, owner, {
      ...base,
      mode: "RENTAL",
      resourceIds: [],
    }).catch((e) => e);
    expect(code(err)).toBe("INVALID_INPUT");
    expect((err as CatalogError).issues).toMatchObject({
      slotMinutes: "Informe o tamanho do horário",
      resourceIds: expect.any(String),
    });
  });

  it("STAFF não cadastra serviço; recurso de outro tenant não entra", async () => {
    expect(
      code(
        await saveOffering(db, T.tenantId, staff1, { ...base, resourceIds: [R1] }).catch((e) => e),
      ),
    ).toBe("FORBIDDEN");
    const err = await saveOffering(db, T.tenantId, owner, {
      ...base,
      resourceIds: [other.resourceIds[0]],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("jornada semanal: substitui tudo e recusa faixas sobrepostas", async () => {
    const rules = [
      { weekday: 1, start: "09:00", end: "12:00" },
      { weekday: 1, start: "13:00", end: "19:00" },
      { weekday: 6, start: "08:00", end: "14:00" },
    ];
    await saveWeeklyRules(db, T.tenantId, owner, R2, rules);
    expect(await getWeeklyRules(db, T.tenantId, R2)).toEqual(rules);
    const err = await saveWeeklyRules(db, T.tenantId, owner, R2, [
      { weekday: 2, start: "09:00", end: "12:00" },
      { weekday: 2, start: "11:00", end: "15:00" },
    ]).catch((e) => e);
    expect(code(err)).toBe("INVALID_INPUT");
    expect(await getWeeklyRules(db, T.tenantId, R2)).toEqual(rules); // nada mudou
    expect(code(await saveWeeklyRules(db, T.tenantId, staff2, R2, rules).catch((e) => e))).toBe(
      "FORBIDDEN",
    );
  });

  it("equipe: adiciona por e-mail (cria a conta), recusa duplicado, gerente não cria dono, STAFF exige agenda", async () => {
    const email = `nova-${randomUUID().slice(0, 6)}@Teste.dev`;
    const m = await addMember(db, T.tenantId, manager, { email, role: "STAFF", resourceId: R2 });
    const [u] = await db.select().from(s.users).where(eq(s.users.id, m.userId));
    expect(u.email).toBe(email.toLowerCase());
    expect(
      code(
        await addMember(db, T.tenantId, owner, { email, role: "MANAGER", resourceId: null }).catch(
          (e) => e,
        ),
      ),
    ).toBe("CONFLICT");
    expect(
      code(
        await addMember(db, T.tenantId, manager, {
          email: "x@y.dev",
          role: "OWNER",
          resourceId: null,
        }).catch((e) => e),
      ),
    ).toBe("FORBIDDEN");
    expect(
      code(
        await addMember(db, T.tenantId, owner, {
          email: "z@y.dev",
          role: "STAFF",
          resourceId: null,
        }).catch((e) => e),
      ),
    ).toBe("INVALID_INPUT");
    await removeMember(db, T.tenantId, manager, m.id);
  });

  it("não remove o último dono", async () => {
    const [own] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.memberships).where(eq(s.memberships.role, "OWNER")),
    );
    expect(code(await removeMember(db, T.tenantId, owner, own.id).catch((e) => e))).toBe(
      "LAST_OWNER",
    );
  });

  it("clientes: dono vê com contador de faltas; STAFF não vê", async () => {
    const list = await listCustomers(db, T.tenantId, owner);
    expect(list.find((c) => c.id === T.customerProfileId)).toMatchObject({ name: "Cliente" });
    expect(code(await listCustomers(db, T.tenantId, staff1).catch((e) => e))).toBe("FORBIDDEN");
  });
});
