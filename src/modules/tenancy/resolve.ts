import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export interface ResolvedTenant {
  tenantId: string;
  slug: string;
  name: string;
  brandColor: string;
  status: "ACTIVE" | "SUSPENDED";
}

type Row = {
  tenant_id: string;
  slug: string;
  name: string;
  brand_color: string;
  status: ResolvedTenant["status"];
};

const toTenant = (r: Row): ResolvedTenant => ({
  tenantId: r.tenant_id,
  slug: r.slug,
  name: r.name,
  brandColor: r.brand_color,
  status: r.status,
});

/**
 * Cache em memória por processo (best effort). Positivo 60s, negativo 15s:
 * um domínio recém-verificado aparece rápido e um host inexistente não martela o banco.
 * Com várias instâncias, troque por Redis (mesma interface).
 */
const TTL_HIT = 60_000;
const TTL_MISS = 15_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { value: ResolvedTenant | null; expires: number }>();

async function cached(key: string, load: () => Promise<ResolvedTenant | null>) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;
  const value = await load();
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: now + (value ? TTL_HIT : TTL_MISS) });
  return value;
}

/** Usa funções SECURITY DEFINER (drizzle/0003): funciona sem contexto de tenant. */
export function resolveTenantBySlug(db: Db, slug: string): Promise<ResolvedTenant | null> {
  return cached(`slug:${slug}`, async () => {
    const r = await db.execute<Row>(sql`select * from resolve_tenant_by_slug(${slug})`);
    return r.rows[0] ? toTenant(r.rows[0]) : null;
  });
}

export function resolveTenantByHost(db: Db, host: string): Promise<ResolvedTenant | null> {
  return cached(`host:${host}`, async () => {
    const r = await db.execute<Row>(sql`select * from resolve_tenant_by_host(${host})`);
    return r.rows[0] ? toTenant(r.rows[0]) : null;
  });
}

/** Chamar quando slug, domínio ou status do tenant mudar. */
export function invalidateTenantCache(): void {
  cache.clear();
}
