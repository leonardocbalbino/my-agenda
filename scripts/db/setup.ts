import { requireEnv, setupDatabase } from "./lib";

async function main() {
  await setupDatabase({
    adminUrl: requireEnv("DATABASE_ADMIN_URL"),
    migratorUrl: requireEnv("DATABASE_MIGRATOR_URL"),
    appUrl: requireEnv("DATABASE_URL"),
    reset: process.argv.includes("--reset"),
    log: console.log,
  });
  console.log("Banco pronto (papéis, extensões e permissões).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
