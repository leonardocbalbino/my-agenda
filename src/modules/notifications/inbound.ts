/**
 * Mensagens que chegam pelo webhook do WhatsApp: botões do lembrete e "PARAR".
 * Idempotente: cada mensagem (wamid) é processada uma vez (tabela webhook_events).
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { phoneVariants } from "@/lib/phone";
import { tenantUrl } from "@/lib/urls";
import { relativeWhen } from "./messages";
import type { WhatsAppProvider } from "./whatsapp";

export type InboundEvent =
  | { id: string; from: string; kind: "button"; payload: string }
  | { id: string; from: string; kind: "text"; text: string };

interface RawMessage {
  id?: unknown;
  from?: unknown;
  type?: string;
  button?: { payload?: unknown };
  interactive?: { button_reply?: { id?: unknown } };
  text?: { body?: unknown };
}

/** Extrai as mensagens do payload da Meta (ignora status de entrega e o resto). */
export function parseWhatsAppWebhook(body: unknown): InboundEvent[] {
  const out: InboundEvent[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: { messages?: unknown[] } }[] }[]) {
    for (const change of entry.changes ?? []) {
      for (const m of (change.value?.messages ?? []) as RawMessage[]) {
        if (typeof m?.id !== "string" || typeof m?.from !== "string") continue;
        if (m.type === "button" && typeof m.button?.payload === "string") {
          out.push({ id: m.id, from: m.from, kind: "button", payload: m.button.payload });
        } else if (
          m.type === "interactive" &&
          typeof m.interactive?.button_reply?.id === "string"
        ) {
          out.push({
            id: m.id,
            from: m.from,
            kind: "button",
            payload: m.interactive.button_reply.id,
          });
        } else if (m.type === "text" && typeof m.text?.body === "string") {
          out.push({ id: m.id, from: m.from, kind: "text", text: m.text.body });
        }
      }
    }
  }
  return out;
}

const STOP = /^\s*(parar|pare|sair|stop|cancelar lembretes|descadastrar)\s*[.!]?\s*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboundOutcome =
  "DUPLICATE" | "CONFIRMED" | "RESCHEDULE_LINK" | "OPTED_OUT" | "IGNORED";

export async function handleInbound(
  db: Db,
  whatsapp: WhatsAppProvider | null,
  event: InboundEvent,
  rawPayload: unknown,
  now = new Date(),
): Promise<InboundOutcome> {
  const claimed = await db
    .insert(webhookEvents)
    .values({
      provider: "whatsapp",
      eventId: event.id,
      type: event.kind,
      payload: rawPayload as object,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!claimed.length) return "DUPLICATE";

  const phones = phoneVariants(event.from);
  const phonesSql = sql`array[${sql.join(
    phones.map((p) => sql`${p}`),
    sql`, `,
  )}]::text[]`;
  let outcome: InboundOutcome = "IGNORED";
  let reply: string | null = null;

  if (event.kind === "button") {
    const [action, bookingId] = event.payload.split(":");
    if ((action === "CONFIRM" || action === "RESCHEDULE") && UUID.test(bookingId ?? "")) {
      const r = await db.execute<{
        tenant_slug: string;
        tenant_name: string;
        status: string;
        starts_at: Date | string;
        timezone: string;
      }>(sql`select * from whatsapp_booking_reply(${bookingId}::uuid, ${phonesSql}, ${action})`);
      const b = r.rows[0];
      if (b) {
        const when = relativeWhen(new Date(b.starts_at), b.timezone, now);
        const link = tenantUrl(b.tenant_slug, `/agendamento/${bookingId}`);
        if (action === "CONFIRM" && b.status === "CONFIRMED") {
          outcome = "CONFIRMED";
          reply = `Presença confirmada! Te esperamos ${when} em ${b.tenant_name}.`;
        } else {
          outcome = "RESCHEDULE_LINK";
          reply = `Para remarcar ou cancelar, use este link: ${link}\nO cancelamento é grátis até 2h antes do horário.`;
        }
      }
    }
  } else if (STOP.test(event.text)) {
    await db.execute(sql`select whatsapp_opt_out(${phonesSql})`);
    outcome = "OPTED_OUT";
    reply =
      "Pronto, você não vai mais receber lembretes por WhatsApp. Para voltar, ative na página do seu agendamento.";
  }

  if (reply && whatsapp) {
    // Resposta livre é permitida: o cliente acabou de mandar mensagem (janela de 24h).
    await whatsapp
      .sendText(event.from, reply)
      .catch((e) => console.error("[whatsapp] resposta falhou", e));
  }
  await db.execute(
    sql`update webhook_events set processed_at = now() where provider = 'whatsapp' and event_id = ${event.id}`,
  );
  return outcome;
}
