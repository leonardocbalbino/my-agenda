/**
 * Seed de desenvolvimento: 1 barbearia (Navalha) e 1 arena (Beira-Rio), com a
 * agenda de "hoje" espelhando o layout do painel. Roda como marcai_migrator,
 * que também está sujeito ao RLS (FORCE): cada tenant é escrito dentro de withTenant.
 *
 * Idempotente: apaga tudo e recria. NUNCA rode contra produção.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, type Tx } from "../../src/db/client";
import * as s from "../../src/db/schema";
import {
  addDays,
  todayIn,
  toISODate,
  weekdayOf,
  zonedTime,
  type LocalDate,
} from "../../src/lib/time";
import { withTenant } from "../../src/modules/tenancy/context";
import { requireEnv } from "./lib";

const TZ = "America/Sao_Paulo";
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];

type BookingRow = typeof s.bookings.$inferInsert;

async function main() {
  const url = requireEnv("DATABASE_MIGRATOR_URL");
  if (/prod/i.test(url)) throw new Error("Recusando rodar seed num banco que parece produção");
  const { db, pool } = createDb(url, 2);
  const today = todayIn(TZ);
  const yesterday = addDays(today, -1);
  const at = (date: LocalDate, hhmm: string) => zonedTime(date, hhmm, TZ);

  try {
    await db.execute(
      sql`TRUNCATE users, plans, holidays, webhook_events, audit_logs, tenants RESTART IDENTITY CASCADE`,
    );

    // --- Global -------------------------------------------------------------
    const [basic, pro] = await db
      .insert(s.plans)
      .values([
        {
          code: "basico",
          name: "Básico",
          monthlyPriceCents: 8900,
          maxResources: 3,
          platformFeeBps: 300,
          marketplaceFeeBps: 800,
        },
        {
          code: "pro",
          name: "Pro",
          monthlyPriceCents: 18900,
          maxResources: 10,
          platformFeeBps: 250,
          marketplaceFeeBps: 700,
        },
      ])
      .returning();

    const year = today.year;
    await db.insert(s.holidays).values([
      { date: `${year}-11-15`, name: "Proclamação da República" },
      { date: `${year}-11-20`, name: "Dia da Consciência Negra" },
      { date: `${year}-12-25`, name: "Natal" },
    ]);

    const userRows = await db
      .insert(s.users)
      .values([
        {
          name: "Admin Marcaí",
          email: "admin@marcai.dev",
          emailVerified: true,
          platformRole: "SUPER_ADMIN",
        },
        { name: "Rafa Souza", email: "rafa@navalha.dev", emailVerified: true },
        { name: "Diego Lima", email: "diego@navalha.dev", emailVerified: true },
        { name: "Carla Gerente", email: "carla@navalha.dev", emailVerified: true },
        { name: "Marcos Arena", email: "marcos@beirario.dev", emailVerified: true },
        {
          name: "Bruno Alves",
          email: "cliente@marcai.dev",
          emailVerified: true,
          phone: "+5511990000001",
        },
      ])
      .returning();
    const u = Object.fromEntries(userRows.map((r) => [r.email.split("@")[0], r]));

    // --- Barbearia Navalha (SERVICE, escolhe profissional, paga no local) ----
    const navalhaId = randomUUID();
    await withTenant(db, navalhaId, async (tx) => {
      await tx.insert(s.tenants).values({
        id: navalhaId,
        slug: "navalha",
        name: "Barbearia Navalha",
        niche: "BARBERSHOP",
        brandColor: "#7A4E24",
        planId: pro.id,
        listedOnMarketplace: true,
      });
      await tx.insert(s.domains).values({
        tenantId: navalhaId,
        host: "navalha.marcai.com.br",
        verified: true,
        isPrimary: true,
      });
      const [loc] = await tx
        .insert(s.locations)
        .values({
          tenantId: navalhaId,
          name: "Pinheiros",
          street: "Rua dos Pinheiros",
          number: "1000",
          neighborhood: "Pinheiros",
          city: "São Paulo",
          stateCode: "SP",
          postalCode: "05422-001",
          geo: { lng: -46.6835, lat: -23.565 },
        })
        .returning();

      const pros = await tx
        .insert(s.resources)
        .values(
          ["Rafa", "Diego", "Lu", "Thiago"].map((name, i) => ({
            tenantId: navalhaId,
            locationId: loc.id,
            kind: "PROFESSIONAL" as const,
            name,
            sortOrder: i,
          })),
        )
        .returning();
      const r = Object.fromEntries(pros.map((p) => [p.name, p]));

      const offers = await tx
        .insert(s.offerings)
        .values(
          [
            ["Corte", 30, 4500],
            ["Corte + barba", 50, 7500],
            ["Barba", 25, 3500],
            ["Sobrancelha", 15, 2000],
            ["Luzes", 90, 15000],
          ].map(([name, duration, price], i) => ({
            tenantId: navalhaId,
            mode: "SERVICE" as const,
            name: name as string,
            durationMinutes: duration as number,
            basePriceCents: price as number,
            paymentPolicy: "ON_SITE" as const,
            sortOrder: i,
          })),
        )
        .returning();
      const o = Object.fromEntries(offers.map((x) => [x.name, x]));

      const who: Record<string, string[]> = {
        Corte: ["Rafa", "Diego", "Lu", "Thiago"],
        "Corte + barba": ["Rafa", "Diego", "Lu", "Thiago"],
        Barba: ["Rafa", "Diego", "Thiago"],
        Sobrancelha: ["Lu"],
        Luzes: ["Lu"],
      };
      await tx.insert(s.offeringResources).values(
        Object.entries(who).flatMap(([offer, names]) =>
          names.map((n) => ({
            tenantId: navalhaId,
            offeringId: o[offer].id,
            resourceId: r[n].id,
          })),
        ),
      );

      // Jornada seg–sáb 09–21 com almoço (Rafa 12–13, Diego 13–14).
      const shifts: Record<string, [string, string][]> = {
        Rafa: [
          ["09:00", "12:00"],
          ["13:00", "21:00"],
        ],
        Diego: [
          ["09:00", "13:00"],
          ["14:00", "21:00"],
        ],
        Lu: [["09:00", "21:00"]],
        Thiago: [["09:00", "21:00"]],
      };
      await tx.insert(s.availabilityRules).values(
        Object.entries(shifts).flatMap(([name, ranges]) =>
          MON_SAT.flatMap((weekday) =>
            ranges.map(([startTime, endTime]) => ({
              tenantId: navalhaId,
              resourceId: r[name].id,
              weekday,
              startTime,
              endTime,
            })),
          ),
        ),
      );
      const blackConsciousness: LocalDate = { year, month: 11, day: 20 };
      await tx.insert(s.availabilityExceptions).values({
        tenantId: navalhaId,
        locationId: loc.id,
        kind: "CLOSED",
        period: { start: at(blackConsciousness, "00:00"), end: at(blackConsciousness, "24:00") },
        reason: "Feriado",
      });

      await tx.insert(s.memberships).values([
        { tenantId: navalhaId, userId: u.rafa.id, role: "OWNER", resourceId: r.Rafa.id },
        { tenantId: navalhaId, userId: u.carla.id, role: "MANAGER" },
        { tenantId: navalhaId, userId: u.diego.id, role: "STAFF", resourceId: r.Diego.id },
      ]);

      const customerNames = [
        "Bruno A.",
        "Caio M.",
        "Paulo S.",
        "Igor T.",
        "Leo F.",
        "Marcos R.",
        "André P.",
        "Gabi N.",
        "Fernanda L.",
        "Rodrigo V.",
        "Pedro H.",
        "João C.",
        "Lucas G.",
      ];
      const profiles = await tx
        .insert(s.customerProfiles)
        .values(
          customerNames.map((name) => ({
            tenantId: navalhaId,
            name,
            userId: name === "Bruno A." ? u.cliente.id : null,
            noShowCount: name === "Caio M." ? 1 : 0,
          })),
        )
        .returning();
      const c = Object.fromEntries(profiles.map((p) => [p.name, p]));

      const booking = (
        customer: string,
        pro: string,
        offer: string,
        start: string,
        status: BookingRow["status"],
        source: BookingRow["source"] = "TENANT_PAGE",
        day: LocalDate = today,
      ): BookingRow => {
        const begin = at(day, start);
        const end = new Date(begin.getTime() + o[offer].durationMinutes! * 60_000);
        return {
          tenantId: navalhaId,
          customerProfileId: c[customer].id,
          customerId: c[customer].userId,
          resourceId: r[pro].id,
          offeringId: o[offer].id,
          period: { start: begin, end },
          status,
          priceCents: o[offer].basePriceCents,
          prepaidCents: status === "PENDING_PAYMENT" ? o[offer].basePriceCents : 0,
          source,
          expiresAt: status === "PENDING_PAYMENT" ? new Date(Date.now() + 10 * 60_000) : null,
        };
      };

      await tx.insert(s.bookings).values([
        booking("Bruno A.", "Rafa", "Corte + barba", "09:00", "COMPLETED", "MARKETPLACE"),
        booking("Caio M.", "Rafa", "Corte", "10:00", "COMPLETED"),
        booking("Paulo S.", "Rafa", "Corte + barba", "11:00", "CONFIRMED", "MARKETPLACE"),
        booking("Igor T.", "Rafa", "Barba", "14:00", "PENDING_PAYMENT", "MARKETPLACE"),
        booking("Leo F.", "Diego", "Corte", "09:30", "COMPLETED"),
        booking("Marcos R.", "Diego", "Corte + barba", "10:30", "CONFIRMED", "PANEL"),
        booking("André P.", "Diego", "Corte", "14:30", "CONFIRMED", "MARKETPLACE"),
        booking("Gabi N.", "Lu", "Sobrancelha", "09:00", "COMPLETED"),
        booking("Fernanda L.", "Lu", "Luzes", "10:00", "CONFIRMED"),
        booking("Rodrigo V.", "Lu", "Corte + barba", "15:00", "PENDING_PAYMENT", "MARKETPLACE"),
        booking("Pedro H.", "Thiago", "Corte", "11:00", "COMPLETED"),
        booking("João C.", "Thiago", "Barba", "11:30", "COMPLETED", "PANEL"),
        booking("Lucas G.", "Thiago", "Corte + barba", "13:30", "CONFIRMED", "MARKETPLACE"),
        // Histórico para cobrir todos os status
        booking("Caio M.", "Diego", "Corte", "18:00", "NO_SHOW", "TENANT_PAGE", yesterday),
        booking("Bruno A.", "Rafa", "Corte", "17:00", "CANCELLED", "MARKETPLACE", yesterday),
      ]);
    });

    // --- Arena Beira-Rio (RENTAL 60 min, horário nobre, sinal 50%, mensalista)
    const arenaId = randomUUID();
    await withTenant(db, arenaId, async (tx: Tx) => {
      await tx.insert(s.tenants).values({
        id: arenaId,
        slug: "arenabeirario",
        name: "Arena Beira-Rio",
        niche: "SPORTS_VENUE",
        brandColor: "#166534",
        planId: basic.id,
        listedOnMarketplace: true,
      });
      await tx.insert(s.domains).values({
        tenantId: arenaId,
        host: "arenabeirario.marcai.com.br",
        verified: true,
        isPrimary: true,
      });
      const [loc] = await tx
        .insert(s.locations)
        .values({
          tenantId: arenaId,
          name: "Arena",
          street: "Rua do Rio",
          number: "200",
          neighborhood: "Lapa",
          city: "São Paulo",
          stateCode: "SP",
          geo: { lng: -46.7031, lat: -23.5205 },
        })
        .returning();

      const spaces = await tx
        .insert(s.resources)
        .values(
          ["Society 1", "Society 2", "Areia"].map((name, i) => ({
            tenantId: arenaId,
            locationId: loc.id,
            kind: "SPACE" as const,
            name,
            sortOrder: i,
          })),
        )
        .returning();
      const r = Object.fromEntries(spaces.map((p) => [p.name, p]));

      const [society, beach] = await tx
        .insert(s.offerings)
        .values(
          [
            { name: "Society", basePriceCents: 16000 },
            { name: "Beach tennis", basePriceCents: 12000 },
          ].map((x, i) => ({
            tenantId: arenaId,
            mode: "RENTAL" as const,
            slotMinutes: 60,
            paymentPolicy: "DEPOSIT" as const,
            depositBps: 5000,
            allowRecurring: true,
            sortOrder: i,
            ...x,
          })),
        )
        .returning();

      await tx.insert(s.offeringResources).values([
        { tenantId: arenaId, offeringId: society.id, resourceId: r["Society 1"].id },
        { tenantId: arenaId, offeringId: society.id, resourceId: r["Society 2"].id },
        { tenantId: arenaId, offeringId: beach.id, resourceId: r.Areia.id },
      ]);

      await tx.insert(s.availabilityRules).values(
        spaces.flatMap((sp) =>
          ALL_WEEK.map((weekday) => ({
            tenantId: arenaId,
            resourceId: sp.id,
            weekday,
            startTime: "08:00",
            endTime: "24:00",
          })),
        ),
      );

      await tx.insert(s.pricingRules).values([
        {
          tenantId: arenaId,
          offeringId: society.id,
          label: "Horário nobre",
          startTime: "18:00",
          endTime: "24:00",
          priceCents: 22000,
          priority: 1,
        },
        {
          tenantId: arenaId,
          offeringId: beach.id,
          label: "Horário nobre",
          startTime: "18:00",
          endTime: "24:00",
          priceCents: 15000,
          priority: 1,
        },
        {
          tenantId: arenaId,
          offeringId: society.id,
          label: "Feriado",
          startTime: "08:00",
          endTime: "24:00",
          holidaysOnly: true,
          priceCents: 22000,
          priority: 10,
        },
      ]);

      await tx
        .insert(s.memberships)
        .values({ tenantId: arenaId, userId: u.marcos.id, role: "OWNER" });

      const profiles = await tx
        .insert(s.customerProfiles)
        .values([
          { tenantId: arenaId, name: "Bruno Alves", userId: u.cliente.id },
          { tenantId: arenaId, name: "Time do Zé" },
          { tenantId: arenaId, name: "Pelada de quinta" },
        ])
        .returning();
      const [bruno, ze, quinta] = profiles;

      const slot = (
        resource: string,
        offeringId: string,
        customer: (typeof profiles)[number],
        day: LocalDate,
        start: string,
        priceCents: number,
        extra: Partial<BookingRow> = {},
      ): BookingRow => {
        const begin = at(day, start);
        return {
          tenantId: arenaId,
          customerProfileId: customer.id,
          customerId: customer.userId,
          resourceId: r[resource].id,
          offeringId,
          period: { start: begin, end: new Date(begin.getTime() + 60 * 60_000) },
          status: "CONFIRMED",
          priceCents,
          prepaidCents: priceCents / 2,
          source: "TENANT_PAGE",
          ...extra,
        };
      };

      // Mensalista: quinta 20h na Society 2, próximas 4 ocorrências já reservadas.
      const [recurring] = await tx
        .insert(s.recurringBookings)
        .values({
          tenantId: arenaId,
          customerProfileId: quinta.id,
          resourceId: r["Society 2"].id,
          offeringId: society.id,
          weekday: 4,
          startTime: "20:00",
          durationMinutes: 60,
          startsOn: toISODate(today),
          monthlyPriceCents: 80000,
        })
        .returning();
      const firstThursday = addDays(today, (4 - weekdayOf(today) + 7) % 7);
      const recurringRows = [0, 7, 14, 21].map((d) =>
        slot("Society 2", society.id, quinta, addDays(firstThursday, d), "20:00", 20000, {
          recurringBookingId: recurring.id,
          prepaidCents: 0,
        }),
      );

      await tx
        .insert(s.bookings)
        .values([
          slot("Society 1", society.id, ze, today, "18:00", 22000),
          slot("Society 1", society.id, bruno, today, "19:00", 22000, { source: "MARKETPLACE" }),
          slot("Society 1", society.id, ze, today, "21:00", 22000),
          slot("Areia", beach.id, bruno, today, "19:00", 15000, { source: "MARKETPLACE" }),
          ...recurringRows,
        ]);
    });

    console.log(`Seed ok (hoje em ${TZ}: ${toISODate(today)})`);
    console.table([
      {
        tenant: "navalha",
        nicho: "Barbearia",
        dono: "rafa@navalha.dev",
        gerente: "carla@navalha.dev",
        staff: "diego@navalha.dev",
      },
      {
        tenant: "arenabeirario",
        nicho: "Arena",
        dono: "marcos@beirario.dev",
        gerente: "-",
        staff: "-",
      },
    ]);
    console.log("Cliente: cliente@marcai.dev · Super admin: admin@marcai.dev");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
