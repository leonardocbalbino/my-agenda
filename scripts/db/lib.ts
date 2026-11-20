import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createDb } from "../../src/db/client";

/** Nomes fixos: as migrations SQL referenciam esses papéis. */
export const ROLES = {
  migrator: "marcai_migrator",
  app: "marcai_app",
  publicReader: "marcai_public",
  jobs: "marcai_jobs",
} as const;

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function passwordOf(url: string, expectedUser: string): string {
  const u = new URL(url);
  if (decodeURIComponent(u.username) !== expectedUser) {
    throw new Error(`A URL deveria usar o papel ${expectedUser}, usa ${u.username}`);
  }
  return decodeURIComponent(u.password);
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface SetupOptions {
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
  /** Apaga e recria o banco. */
  reset?: boolean;
  log?: (msg: string) => void;
}

/**
 * Bootstrap como SUPERUSUÁRIO (idempotente):
 * papéis, banco (dono = migrator), extensões e permissões de schema.
 * Em produção isso é feito pela infra; aqui serve dev e testes.
 */
export async function setupDatabase(opts: SetupOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const database = databaseOf(opts.migratorUrl);
  if (databaseOf(opts.appUrl) !== database) {
    throw new Error("DATABASE_URL e DATABASE_MIGRATOR_URL precisam apontar para o mesmo banco");
  }
  const migratorPassword = passwordOf(opts.migratorUrl, ROLES.migrator);
  const appPassword = passwordOf(opts.appUrl, ROLES.app);

  const admin = new Client({ connectionString: opts.adminUrl });
  await admin.connect();
  try {
    const roles: [string, string][] = [
      [
        ROLES.migrator,
        `LOGIN PASSWORD ${literal(migratorPassword)} NOSUPERUSER NOBYPASSRLS NOCREATEROLE`,
      ],
      [
        ROLES.app,
        `LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`,
      ],
      // Dono da view public_listings. Não loga; só existe para atravessar o RLS de forma controlada.
      [ROLES.publicReader, "NOLOGIN NOSUPERUSER BYPASSRLS"],
      // Dono das funções de manutenção entre tenants (ex.: expirar pendências). Não loga.
      [ROLES.jobs, "NOLOGIN NOSUPERUSER BYPASSRLS"],
    ];
    for (const [name, attrs] of roles) {
      const exists = await admin.query("select 1 from pg_roles where rolname = $1", [name]);
      await admin.query(
        `${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${ident(name)} WITH ${attrs}`,
      );
    }
    // O migrator precisa poder transferir objetos para esses papéis.
    await admin.query(`GRANT ${ident(ROLES.publicReader)} TO ${ident(ROLES.migrator)}`);
    await admin.query(`GRANT ${ident(ROLES.jobs)} TO ${ident(ROLES.migrator)}`);

    if (opts.reset) {
      log(`Apagando banco ${database}`);
      await admin.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
    }
    const dbExists = await admin.query("select 1 from pg_database where datname = $1", [database]);
    if (!dbExists.rowCount) {
      log(`Criando banco ${database}`);
      await admin.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(ROLES.migrator)}`);
    }
  } finally {
    await admin.end();
  }

  const adminOnDb = new Client({ connectionString: withDatabase(opts.adminUrl, database) });
  await adminOnDb.connect();
  try {
    // postgis não é "trusted": só superusuário cria.
    await adminOnDb.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await adminOnDb.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    // Busca do marketplace sem acento ("salao" acha "Salão").
    await adminOnDb.query("CREATE EXTENSION IF NOT EXISTS unaccent");
    await adminOnDb.query(`REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC`);
    await adminOnDb.query(
      `GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(ROLES.app)}, ${ident(ROLES.migrator)}`,
    );
    await adminOnDb.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    // Dono de objeto precisa de CREATE no schema (exigência do ALTER ... OWNER).
    await adminOnDb.query(
      `GRANT CREATE, USAGE ON SCHEMA public TO ${ident(ROLES.publicReader)}, ${ident(ROLES.jobs)}`,
    );
  } finally {
    await adminOnDb.end();
  }
}

export async function runMigrations(migratorUrl: string): Promise<void> {
  const { db, pool } = createDb(migratorUrl, 1);
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não definida (copie .env.example para .env)`);
  return v;
}
