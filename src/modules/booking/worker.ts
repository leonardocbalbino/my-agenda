import { Queue, Worker, type Job } from "bullmq";
import type { Db } from "@/db/client";
import { BOOKING_QUEUE, redisConnection } from "./queue";
import { expireBooking, sweepExpiredBookings } from "./service";

/** Processa um job (separado do Worker para ser testável sem Redis). */
export async function processBookingJob(db: Db, job: Pick<Job, "name" | "data">) {
  switch (job.name) {
    case "expire-booking": {
      const { tenantId, bookingId } = job.data as { tenantId: string; bookingId: string };
      return { expired: await expireBooking(db, tenantId, bookingId) };
    }
    case "sweep-expired":
      return { expired: (await sweepExpiredBookings(db)).length };
    default:
      throw new Error(`Job desconhecido: ${job.name}`);
  }
}

export interface StartedWorker {
  close(): Promise<void>;
}

export async function startBookingWorker(
  db: Db,
  opts: { queueName?: string; sweepEveryMs?: number } = {},
): Promise<StartedWorker> {
  const name = opts.queueName ?? BOOKING_QUEUE;
  const connection = { ...redisConnection(), maxRetriesPerRequest: null };
  const worker = new Worker(name, (job) => processBookingJob(db, job), {
    connection,
    concurrency: 10,
  });
  worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} falhou`, err));

  const queue = new Queue(name, { connection });
  await queue.upsertJobScheduler(
    "sweep-expired",
    { every: opts.sweepEveryMs ?? 60_000 },
    { name: "sweep-expired", data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );

  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
