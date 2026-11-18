import { sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";

export interface RequestContext {
  /** Tenant da requisição (resolvido pelo Host). Nulo = fora de qualquer tenant. */
  tenantId: string | null;
  /** Usuário logado (conta global), se houver. */
  userId?: string | null;
}

/**
 * Executa `fn` numa transação com o contexto de RLS definido:
 *   app.tenant_id -> policies tenant_isolation
 *   app.user_id   -> policies customer_reads_own / member_reads_own
 * `set_config(..., true)` é local à transação: com pool de conexões, o contexto
 * nunca vaza para a próxima requisição que pegar a mesma conexão.
 */
export async function withContext<T>(
  db: Db,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

export function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  userId?: string | null,
): Promise<T> {
  return withContext(db, { tenantId, userId }, fn);
}
