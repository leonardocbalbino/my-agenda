import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { withContext, withTenant } from "@/modules/tenancy/context";
import type { MembershipRole } from "./permissions";

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  locationId: string | null;
  resourceId: string | null;
}

/** Membership do usuário NO tenant (consulta sob RLS do próprio tenant). */
export async function loadMembership(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<Membership | null> {
  const rows = await withTenant(
    db,
    tenantId,
    (tx) =>
      tx
        .select({
          id: memberships.id,
          tenantId: memberships.tenantId,
          userId: memberships.userId,
          role: memberships.role,
          locationId: memberships.locationId,
          resourceId: memberships.resourceId,
        })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
        .limit(1),
    userId,
  );
  return rows[0] ?? null;
}

export interface MyBusiness {
  tenantId: string;
  slug: string;
  name: string;
  role: MembershipRole;
}

/** Negócios do usuário (tela "Seus negócios"), via função SECURITY DEFINER. */
export async function listMyBusinesses(db: Db, userId: string): Promise<MyBusiness[]> {
  const r = await withContext(db, { tenantId: null, userId }, (tx) =>
    tx.execute<{ tenant_id: string; slug: string; name: string; role: MembershipRole }>(
      sql`select * from my_memberships()`,
    ),
  );
  return r.rows.map((x) => ({ tenantId: x.tenant_id, slug: x.slug, name: x.name, role: x.role }));
}

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const [u] = await db
    .select({ role: users.platformRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.role === "SUPER_ADMIN";
}
