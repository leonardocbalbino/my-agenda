/**
 * Fila de jobs de reservas (BullMQ + Redis).
 *   expire-booking  atrasado até expires_at, um por reserva pendente
 *   sweep-expired   a cada minuto, rede de segurança entre tenants
 */
import { Queue, type ConnectionOptions } from "bullmq";

export const BOOKING_QUEUE = "booking";

export type BookingJob =
  | { name: "expire-booking"; data: { tenantId: string; bookingId: string } }
  | { name: "sweep-expired"; data: Record<string, never> };

export function redisConnection(url = process.env.REDIS_URL): ConnectionOptions {
  if (!url) throw new Error("REDIS_URL não definida");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
  };
}

const globalForQueue = globalThis as unknown as { __marcaiBookingQueue?: Queue };

function producer(): Queue {
  globalForQueue.__marcaiBookingQueue ??= new Queue(BOOKING_QUEUE, {
    // Produtor falha rápido se o Redis cair: a reserva não pode travar por causa da fila.
    connection: { ...redisConnection(), enableOfflineQueue: false, maxRetriesPerRequest: 1 },
  });
  return globalForQueue.__marcaiBookingQueue;
}

/**
 * Agenda a expiração de uma reserva pendente. Best effort: se o Redis estiver
 * fora, só registra o erro; a varredura periódica e o createBooking cobrem.
 */
export async function scheduleExpiration(job: {
  tenantId: string;
  bookingId: string;
  expiresAt: Date;
}): Promise<void> {
  const delay = Math.max(0, job.expiresAt.getTime() - Date.now()) + 1_000;
  try {
    await Promise.race([
      producer().add(
        "expire-booking",
        { tenantId: job.tenantId, bookingId: job.bookingId },
        { delay, jobId: `expire-${job.bookingId}`, removeOnComplete: true, removeOnFail: 500 },
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout da fila")), 2_000)),
    ]);
  } catch (err) {
    console.error("[booking] não foi possível agendar a expiração", job.bookingId, err);
  }
}
