import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Toda conexão em UTC: o fuso da Location só é usado na borda (regras locais e exibição). */
export function createDb(connectionString: string, max = 10): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max, options: "-c TimeZone=UTC" });
  return { db: drizzle(pool, { schema }), pool };
}

const globalForDb = globalThis as unknown as { __marcaiDb?: { db: Db; pool: Pool } };

/**
 * Conexão da APLICAÇÃO (papel marcai_app, sujeito ao RLS). Nunca use a URL do
 * migrator aqui. Para acessar dados de tenant, passe por `withTenant`.
 */
export function getDb(): Db {
  if (!globalForDb.__marcaiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida");
    globalForDb.__marcaiDb = createDb(url);
  }
  return globalForDb.__marcaiDb.db;
}
