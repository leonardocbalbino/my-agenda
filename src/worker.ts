/**
 * Processo de jobs (separado do Next): pnpm worker
 * Expira reservas pendentes e envia confirmações e lembretes (WhatsApp/e-mail).
 */
import { createDb } from "@/db/client";
import { startBookingWorker } from "@/modules/booking/worker";
import {
  getEmailProvider,
  getWhatsAppProvider,
  processDueNotifications,
} from "@/modules/notifications";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const { db, pool } = createDb(url, 5);
  const whatsapp = getWhatsAppProvider();
  const email = getEmailProvider();
  const worker = await startBookingWorker(db, {
    notify: async () => {
      const r = await processDueNotifications(db, { whatsapp, email });
      if (r.sent || r.failed) console.info("[worker] notificações", r);
      return r;
    },
  });
  console.info(
    `[worker] ouvindo a fila de reservas · WhatsApp: ${whatsapp ? whatsapp.constructor.name : "desligado"}`,
  );

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
