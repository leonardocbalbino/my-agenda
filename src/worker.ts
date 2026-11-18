/**
 * Processo de jobs (separado do Next): pnpm worker
 * Expira reservas pendentes e, nas próximas etapas, envia lembretes.
 */
import { createDb } from "@/db/client";
import { startBookingWorker } from "@/modules/booking/worker";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const { db, pool } = createDb(url, 5);
  const worker = await startBookingWorker(db);
  console.info("[worker] ouvindo a fila de reservas");

  const shutdown = async () => {
    console.info("[worker] encerrando");
    await worker.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
