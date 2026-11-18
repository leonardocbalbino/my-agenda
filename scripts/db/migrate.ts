import { requireEnv, runMigrations } from "./lib";

runMigrations(requireEnv("DATABASE_MIGRATOR_URL"))
  .then(() => console.log("Migrations aplicadas."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
