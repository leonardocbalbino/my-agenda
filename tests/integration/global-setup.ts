import { existsSync } from "node:fs";
import type { TestProject } from "vitest/node";
import { runMigrations, setupDatabase, withDatabase } from "../../scripts/db/lib";

declare module "vitest" {
  export interface ProvidedContext {
    appUrl: string;
    migratorUrl: string;
  }
}

export default async function setup(project: TestProject) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} não definida (copie .env.example para .env)`);
    return v;
  };
  const name = process.env.TEST_DATABASE_NAME ?? "marcai_test";
  const appUrl = withDatabase(need("DATABASE_URL"), name);
  const migratorUrl = withDatabase(need("DATABASE_MIGRATOR_URL"), name);

  await setupDatabase({ adminUrl: need("DATABASE_ADMIN_URL"), appUrl, migratorUrl, reset: true });
  await runMigrations(migratorUrl);

  project.provide("appUrl", appUrl);
  project.provide("migratorUrl", migratorUrl);
}
