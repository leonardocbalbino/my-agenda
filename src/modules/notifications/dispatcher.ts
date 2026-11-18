/**
 * Envio de confirmações e lembretes devidos (chamado pelo worker a cada minuto).
 *
 * 1. due_notifications() lista o que está devido em todos os tenants.
 * 2. Cada item é "reivindicado" com INSERT ... ON CONFLICT DO NOTHING na chave
 *    (reserva, tipo, horário): com dois workers, só um envia.
 * 3. WhatsApp se houver consentimento; senão (ou se falhar) e-mail; senão nada.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notificationLog } from "@/db/schema";
import { maskPhone } from "@/lib/phone";
import { withTenant } from "@/modules/tenancy/context";
import type { EmailProvider } from "./email";
import { renderNotification, type NotificationKind } from "./messages";
import type { WhatsAppProvider } from "./whatsapp";

export interface DispatchDeps {
  whatsapp: WhatsAppProvider | null;
  email: EmailProvider;
  now?: Date;
  limit?: number;
}

type DueRow = {
  booking_id: string;
  tenant_id: string;
  kind: NotificationKind;
  booking_start: Date | string;
  booking_end: Date | string;
  tenant_slug: string;
  tenant_name: string;
  offering_name: string;
  resource_name: string;
  timezone: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
};

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  return `${user.charAt(0)}***@${domain ?? ""}`;
}

export async function listDueNotifications(db: Db, now = new Date(), limit = 200) {
  const r = await db.execute<DueRow>(
    sql`select * from due_notifications(${now.toISOString()}::timestamptz, ${limit})`,
  );
  return r.rows;
}

export async function processDueNotifications(db: Db, deps: DispatchDeps) {
  const now = deps.now ?? new Date();
  const rows = await listDueNotifications(db, now, deps.limit);
  const result = { sent: 0, failed: 0, skipped: 0, claimedByOthers: 0 };

  for (const row of rows) {
    const start = new Date(row.booking_start);
    const claim = await withTenant(db, row.tenant_id, (tx) =>
      tx
        .insert(notificationLog)
        .values({
          tenantId: row.tenant_id,
          bookingId: row.booking_id,
          kind: row.kind,
          bookingStart: start,
        })
        .onConflictDoNothing()
        .returning({ id: notificationLog.id }),
    );
    if (!claim.length) {
      result.claimedByOthers++;
      continue;
    }

    const msg = renderNotification(
      {
        bookingId: row.booking_id,
        kind: row.kind,
        start,
        end: new Date(row.booking_end),
        timezone: row.timezone,
        tenantSlug: row.tenant_slug,
        tenantName: row.tenant_name,
        offeringName: row.offering_name,
        resourceName: row.resource_name,
        customerName: row.customer_name,
      },
      now,
    );

    let outcome: Partial<typeof notificationLog.$inferInsert> = {
      status: "SKIPPED",
      channel: "NONE",
    };
    const errors: string[] = [];
    if (row.phone && deps.whatsapp) {
      try {
        const r = await deps.whatsapp.sendTemplate(row.phone, msg.template, msg.text);
        outcome = {
          status: "SENT",
          channel: "WHATSAPP",
          recipient: maskPhone(row.phone),
          providerMessageId: r.id,
        };
      } catch (e) {
        errors.push(`whatsapp: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (outcome.status !== "SENT" && row.email) {
      try {
        await deps.email.send({ to: row.email, subject: msg.subject, text: msg.text });
        outcome = { status: "SENT", channel: "EMAIL", recipient: maskEmail(row.email) };
      } catch (e) {
        errors.push(`email: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (outcome.status !== "SENT" && errors.length) outcome = { status: "FAILED", channel: "NONE" };

    await withTenant(db, row.tenant_id, (tx) =>
      tx
        .update(notificationLog)
        .set({ ...outcome, error: errors.join("; ").slice(0, 500) || null, updatedAt: new Date() })
        .where(and(eq(notificationLog.id, claim[0].id))),
    );
    if (outcome.status === "SENT") result.sent++;
    else if (outcome.status === "FAILED") result.failed++;
    else result.skipped++;
  }
  return result;
}
