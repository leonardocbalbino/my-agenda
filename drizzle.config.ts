import { defineConfig } from "drizzle-kit";

/**
 * Migrations rodam SEMPRE como o papel `marcai_migrator` (dono das tabelas).
 * A aplicação conecta como `marcai_app`, sujeito ao RLS.
 * Tabelas vêm do schema TS (drizzle-kit generate); RLS, exclusion constraint,
 * grants e views ficam em migrations SQL custom (drizzle-kit generate --custom).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_MIGRATOR_URL ?? "" },
  strict: true,
  verbose: true,
});
