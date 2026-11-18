import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { createDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/modules/tenancy/context";

/** Conexão como marcai_app: exatamente o papel que a aplicação usa. */
export function appDb(max = 20) {
  return createDb(inject("appUrl"), max);
}

/** Código SQLSTATE de um erro do pg, mesmo embrulhado pelo Drizzle. */
export function pgCode(err: unknown): string | undefined {
  let e = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if (typeof e.code === "string") return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

export const HOUR = 60 * 60_000;

/** Um instante fixo "limpo" por teste, para não colidir entre arquivos. */
export function slotAt(base: Date, hoursFromBase: number, minutes = 60) {
  const start = new Date(base.getTime() + hoursFromBase * HOUR);
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

export interface TenantFixture {
  tenantId: string;
  locationId: string;
  resourceIds: [string, string];
  offeringId: string;
  customerProfileId: string;
  bookingId: string;
  userId: string;
}

/**
 * Cria um tenant com pelo menos uma linha em CADA tabela de tenant, usando o
 * papel da aplicação (prova também que o WITH CHECK aceita escrita no próprio tenant).
 */
export async function createTenantFixture(
  db: Db,
  opts: { listed?: boolean; customerUserId?: string } = {},
): Promise<TenantFixture> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  const [user] = await db
    .insert(s.users)
    .values({ name: `Dono ${tag}`, email: `dono-${tag}@teste.dev` })
    .returning();
  const [plan] = await db
    .insert(s.plans)
    .values({
      code: `p-${tag}`,
      name: "Plano teste",
      monthlyPriceCents: 1000,
      platformFeeBps: 300,
      marketplaceFeeBps: 800,
    })
    .returning();

  return withTenant(db, tenantId, async (tx) => {
    await tx.insert(s.tenants).values({
      id: tenantId,
      slug: `t-${tag}`,
      name: `Tenant ${tag}`,
      niche: "BARBERSHOP",
      planId: plan.id,
      listedOnMarketplace: opts.listed ?? false,
    });
    await tx.insert(s.domains).values({ tenantId, host: `t-${tag}.teste.dev` });
    const [loc] = await tx
      .insert(s.locations)
      .values({
        tenantId,
        name: "Sede",
        street: "Rua A",
        neighborhood: "Centro",
        city: "São Paulo",
        stateCode: "SP",
        geo: { lng: -46.63, lat: -23.55 },
      })
      .returning();
    const res = await tx
      .insert(s.resources)
      .values([
        { tenantId, locationId: loc.id, kind: "PROFESSIONAL", name: "R1" },
        { tenantId, locationId: loc.id, kind: "PROFESSIONAL", name: "R2" },
      ])
      .returning();
    const [offer] = await tx
      .insert(s.offerings)
      .values({
        tenantId,
        mode: "SERVICE",
        name: "Corte",
        durationMinutes: 30,
        basePriceCents: 4500,
      })
      .returning();
    await tx
      .insert(s.offeringResources)
      .values(res.map((r) => ({ tenantId, offeringId: offer.id, resourceId: r.id })));
    await tx.insert(s.availabilityRules).values({
      tenantId,
      resourceId: res[0].id,
      weekday: 1,
      startTime: "09:00",
      endTime: "18:00",
    });
    await tx.insert(s.availabilityExceptions).values({
      tenantId,
      locationId: loc.id,
      period: { start: new Date("2030-01-01T03:00:00Z"), end: new Date("2030-01-02T03:00:00Z") },
    });
    await tx.insert(s.pricingRules).values({
      tenantId,
      offeringId: offer.id,
      startTime: "18:00",
      endTime: "21:00",
      priceCents: 5000,
    });
    const [profile] = await tx
      .insert(s.customerProfiles)
      .values({ tenantId, name: "Cliente", userId: opts.customerUserId ?? null })
      .returning();
    await tx.insert(s.memberships).values({ tenantId, userId: user.id, role: "OWNER" });
    const [recurring] = await tx
      .insert(s.recurringBookings)
      .values({
        tenantId,
        customerProfileId: profile.id,
        resourceId: res[1].id,
        offeringId: offer.id,
        weekday: 2,
        startTime: "20:00",
        durationMinutes: 60,
        startsOn: "2030-01-01",
        monthlyPriceCents: 80000,
      })
      .returning();
    const [booking] = await tx
      .insert(s.bookings)
      .values({
        tenantId,
        customerProfileId: profile.id,
        customerId: opts.customerUserId ?? null,
        resourceId: res[0].id,
        offeringId: offer.id,
        period: slotAt(new Date("2030-01-07T12:00:00Z"), 0, 30),
        priceCents: 4500,
        source: "TENANT_PAGE",
      })
      .returning();
    await tx.insert(s.payments).values({
      tenantId,
      recurringBookingId: recurring.id,
      provider: "asaas",
      providerPaymentId: `pay-${tag}`,
      method: "PIX",
      amountCents: 80000,
      platformFeeCents: 2400,
    });
    await tx.insert(s.subscriptions).values({ tenantId, planId: plan.id, provider: "asaas" });

    return {
      tenantId,
      locationId: loc.id,
      resourceIds: [res[0].id, res[1].id],
      offeringId: offer.id,
      customerProfileId: profile.id,
      bookingId: booking.id,
      userId: user.id,
    };
  });
}
