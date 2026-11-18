/**
 * Cadastros do painel: serviços, recursos (profissionais/espaços), jornada
 * semanal, fechamentos da unidade, equipe e clientes.
 * Entradas validadas com zod; permissão conferida aqui (além do guard da página).
 */
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  customerProfiles,
  locations,
  memberships,
  offeringResources,
  offerings,
  resources,
  users,
} from "@/db/schema";
import { can, type MembershipRole, type Permission } from "@/modules/identity/permissions";
import { withTenant } from "@/modules/tenancy/context";

export class CatalogError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "LAST_OWNER" | "CONFLICT",
    message: string,
    readonly issues?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  membership: { role: MembershipRole; resourceId: string | null };
}

function assertPermission(actor: Actor, permission: Permission) {
  if (!can(actor.membership.role, permission)) {
    throw new CatalogError("FORBIDDEN", "Você não tem permissão para isso");
  }
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issues: Record<string, string> = {};
    for (const i of r.error.issues) issues[i.path.join(".") || "_"] ??= i.message;
    throw new CatalogError("INVALID_INPUT", "Confira os campos destacados", issues);
  }
  return r.data;
}

const uuid = z.uuid("Identificador inválido");
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

// --- Serviços ------------------------------------------------------------------

export const offeringSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1, "Informe o nome").max(80, "Nome muito longo"),
    mode: z.enum(["SERVICE", "RENTAL"]),
    durationMinutes: z.number().int().min(5, "Mínimo 5 min").max(720, "Máximo 12h").nullable(),
    slotMinutes: z.number().int().min(15, "Mínimo 15 min").max(720, "Máximo 12h").nullable(),
    basePriceCents: z.number().int("Valor inválido").min(0, "Valor inválido").max(10_000_000),
    paymentPolicy: z.enum(["ON_SITE", "DEPOSIT", "FULL"]),
    depositPercent: z.number().int().min(1, "Entre 1% e 100%").max(100, "Entre 1% e 100%"),
    allowRecurring: z.boolean(),
    active: z.boolean(),
    resourceIds: z.array(uuid).min(1, "Escolha ao menos um profissional ou espaço"),
  })
  .superRefine((o, ctx) => {
    if (o.mode === "SERVICE" && !o.durationMinutes) {
      ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Informe a duração" });
    }
    if (o.mode === "RENTAL" && !o.slotMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["slotMinutes"],
        message: "Informe o tamanho do horário",
      });
    }
  });
export type OfferingInput = z.input<typeof offeringSchema>;

export async function listOfferingsAdmin(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(offerings)
      .orderBy(asc(offerings.sortOrder), asc(offerings.name));
    const links = await tx.select().from(offeringResources);
    return rows.map((o) => ({
      ...o,
      resourceIds: links.filter((l) => l.offeringId === o.id).map((l) => l.resourceId),
    }));
  });
}

export async function saveOffering(db: Db, tenantId: string, actor: Actor, input: OfferingInput) {
  assertPermission(actor, "catalog:manage");
  const o = parse(offeringSchema, input);
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const values = {
        name: o.name,
        mode: o.mode,
        durationMinutes: o.mode === "SERVICE" ? o.durationMinutes : null,
        slotMinutes: o.mode === "RENTAL" ? o.slotMinutes : null,
        basePriceCents: o.basePriceCents,
        paymentPolicy: o.paymentPolicy,
        depositBps: o.depositPercent * 100,
        allowRecurring: o.allowRecurring,
        active: o.active,
        updatedAt: new Date(),
      };
      let id = o.id;
      if (id) {
        const updated = await tx
          .update(offerings)
          .set(values)
          .where(eq(offerings.id, id))
          .returning({ id: offerings.id });
        if (!updated.length) throw new CatalogError("NOT_FOUND", "Serviço não encontrado");
      } else {
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${offerings.sortOrder}), -1)::int` })
          .from(offerings);
        const [row] = await tx
          .insert(offerings)
          .values({ tenantId, ...values, sortOrder: max.n + 1 })
          .returning({ id: offerings.id });
        id = row.id;
      }
      // Recursos são validados pela FK composta (tenant_id, id): de outro tenant não entra.
      await tx.delete(offeringResources).where(eq(offeringResources.offeringId, id));
      await tx
        .insert(offeringResources)
        .values(o.resourceIds.map((resourceId) => ({ tenantId, offeringId: id!, resourceId })));
      return id!;
    },
    actor.userId,
  );
}

// --- Recursos (profissionais, quadras) -------------------------------------------

export const resourceSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Informe o nome").max(60, "Nome muito longo"),
  kind: z.enum(["PROFESSIONAL", "SPACE", "EQUIPMENT"]),
  active: z.boolean(),
});

export async function listResourcesAdmin(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx.select().from(resources).orderBy(asc(resources.sortOrder), asc(resources.name)),
  );
}

export async function saveResource(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: z.input<typeof resourceSchema>,
) {
  assertPermission(actor, "team:manage");
  const r = parse(resourceSchema, input);
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      if (r.id) {
        const updated = await tx
          .update(resources)
          .set({ name: r.name, kind: r.kind, active: r.active, updatedAt: new Date() })
          .where(eq(resources.id, r.id))
          .returning({ id: resources.id });
        if (!updated.length) throw new CatalogError("NOT_FOUND", "Não encontrado");
        return r.id;
      }
      const [loc] = await tx.select({ id: locations.id }).from(locations).limit(1);
      if (!loc)
        throw new CatalogError("NOT_FOUND", "Cadastre o endereço do estabelecimento primeiro");
      const [max] = await tx
        .select({ n: sql<number>`coalesce(max(${resources.sortOrder}), -1)::int` })
        .from(resources);
      const [row] = await tx
        .insert(resources)
        .values({
          tenantId,
          locationId: loc.id,
          name: r.name,
          kind: r.kind,
          active: r.active,
          sortOrder: max.n + 1,
        })
        .returning({ id: resources.id });
      return row.id;
    },
    actor.userId,
  );
}

// --- Jornada semanal -----------------------------------------------------------------

export const weeklyRulesSchema = z
  .array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        start: z.string().regex(HHMM, "Hora inválida"),
        end: z.string().regex(HHMM, "Hora inválida"),
      })
      .refine((r) => r.end > r.start, {
        message: "O fim precisa ser depois do início",
        path: ["end"],
      }),
  )
  .superRefine((rules, ctx) => {
    for (let wd = 0; wd <= 6; wd++) {
      const day = rules
        .map((r, i) => ({ ...r, i }))
        .filter((r) => r.weekday === wd)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let k = 1; k < day.length; k++) {
        if (day[k].start < day[k - 1].end) {
          ctx.addIssue({
            code: "custom",
            path: [day[k].i, "start"],
            message: "Faixas do mesmo dia se sobrepõem",
          });
        }
      }
    }
  });
export type WeeklyRule = z.infer<typeof weeklyRulesSchema>[number];

export async function getWeeklyRules(
  db: Db,
  tenantId: string,
  resourceId: string,
): Promise<WeeklyRule[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(availabilityRules)
      .where(eq(availabilityRules.resourceId, resourceId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
  );
  return rows.map((r) => ({
    weekday: r.weekday,
    start: r.startTime.slice(0, 5),
    end: r.endTime.slice(0, 5),
  }));
}

/** Substitui a jornada semanal inteira do recurso (atômico). */
export async function saveWeeklyRules(
  db: Db,
  tenantId: string,
  actor: Actor,
  resourceId: string,
  input: unknown,
) {
  assertPermission(actor, "team:manage");
  const rules = parse(weeklyRulesSchema, input);
  parse(uuid, resourceId);
  await withTenant(
    db,
    tenantId,
    async (tx) => {
      const [r] = await tx
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.id, resourceId));
      if (!r) throw new CatalogError("NOT_FOUND", "Não encontrado");
      await tx.delete(availabilityRules).where(eq(availabilityRules.resourceId, resourceId));
      if (rules.length) {
        await tx.insert(availabilityRules).values(
          rules.map((x) => ({
            tenantId,
            resourceId,
            weekday: x.weekday,
            startTime: x.start,
            endTime: x.end,
          })),
        );
      }
    },
    actor.userId,
  );
}

// --- Fechamentos da unidade (feriado, reforma) --------------------------------------

export async function listUpcomingClosures(db: Db, tenantId: string, now = new Date()) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: availabilityExceptions.id,
        resourceId: availabilityExceptions.resourceId,
        resourceName: resources.name,
        period: availabilityExceptions.period,
        reason: availabilityExceptions.reason,
      })
      .from(availabilityExceptions)
      .leftJoin(resources, eq(resources.id, availabilityExceptions.resourceId))
      .where(
        and(
          eq(availabilityExceptions.kind, "CLOSED"),
          sql`upper(${availabilityExceptions.period}) > ${now.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(sql`lower(${availabilityExceptions.period})`)
      .limit(50),
  );
}

// --- Equipe (memberships) -------------------------------------------------------------

export const memberSchema = z.object({
  email: z.email("E-mail inválido").transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().max(80).optional(),
  role: z.enum(["OWNER", "MANAGER", "STAFF"]),
  resourceId: uuid.nullable(),
});

export async function listMembers(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        resourceId: memberships.resourceId,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(asc(memberships.role), asc(users.name)),
  );
}

/**
 * Adiciona alguém à equipe pelo e-mail. Se a pessoa ainda não tem conta, a conta
 * global é criada já com esse e-mail: no primeiro login por link mágico ela entra.
 * Só o dono adiciona outro dono.
 */
export async function addMember(
  db: Db,
  tenantId: string,
  actor: Actor,
  input: z.input<typeof memberSchema>,
) {
  assertPermission(actor, "team:manage");
  const m = parse(memberSchema, input);
  if (m.role === "OWNER" && actor.membership.role !== "OWNER") {
    throw new CatalogError("FORBIDDEN", "Só o dono pode adicionar outro dono");
  }
  if (m.role === "STAFF" && !m.resourceId) {
    throw new CatalogError("INVALID_INPUT", "Escolha a agenda de quem é da equipe", {
      resourceId: "Obrigatório para equipe",
    });
  }
  let [user] = await db.select().from(users).where(eq(users.email, m.email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: m.email, name: m.name || m.email.split("@")[0] })
      .onConflictDoNothing()
      .returning();
    user ??= (await db.select().from(users).where(eq(users.email, m.email)))[0];
  }
  return withTenant(
    db,
    tenantId,
    async (tx) => {
      const [existing] = await tx.select().from(memberships).where(eq(memberships.userId, user.id));
      if (existing) throw new CatalogError("CONFLICT", "Essa pessoa já faz parte da equipe");
      const [row] = await tx
        .insert(memberships)
        .values({ tenantId, userId: user.id, role: m.role, resourceId: m.resourceId })
        .returning();
      return row;
    },
    actor.userId,
  );
}

export async function removeMember(db: Db, tenantId: string, actor: Actor, membershipId: string) {
  assertPermission(actor, "team:manage");
  parse(uuid, membershipId);
  await withTenant(
    db,
    tenantId,
    async (tx) => {
      const [m] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .for("update");
      if (!m) throw new CatalogError("NOT_FOUND", "Não encontrado");
      if (m.role === "OWNER") {
        if (actor.membership.role !== "OWNER") {
          throw new CatalogError("FORBIDDEN", "Só o dono pode remover um dono");
        }
        const [others] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .where(and(eq(memberships.role, "OWNER"), ne(memberships.id, m.id)));
        if (others.n === 0)
          throw new CatalogError("LAST_OWNER", "O negócio precisa de pelo menos um dono");
      }
      await tx.delete(memberships).where(eq(memberships.id, m.id));
    },
    actor.userId,
  );
}

// --- Clientes -------------------------------------------------------------------------

export async function listCustomers(db: Db, tenantId: string, actor: Actor, now = new Date()) {
  assertPermission(actor, "customers:view");
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: customerProfiles.id,
        name: customerProfiles.name,
        phone: customerProfiles.phone,
        email: customerProfiles.email,
        noShowCount: customerProfiles.noShowCount,
        hasAccount: sql<boolean>`${customerProfiles.userId} is not null`,
        visits: sql<number>`count(${bookings.id}) filter (where ${bookings.status} = 'COMPLETED')::int`,
        lastVisit: sql<
          string | null
        >`max(lower(${bookings.period})) filter (where ${bookings.status} = 'COMPLETED')`,
        nextVisit: sql<
          string | null
        >`min(lower(${bookings.period})) filter (where ${bookings.status} in ('CONFIRMED', 'PENDING_PAYMENT') and lower(${bookings.period}) > ${now.toISOString()}::timestamptz)`,
      })
      .from(customerProfiles)
      .leftJoin(bookings, eq(bookings.customerProfileId, customerProfiles.id))
      .groupBy(customerProfiles.id)
      .orderBy(desc(sql`max(lower(${bookings.period}))`), asc(customerProfiles.name))
      .limit(500),
  );
}
