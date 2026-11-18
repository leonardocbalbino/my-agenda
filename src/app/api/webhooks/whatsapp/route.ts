import { getDb } from "@/db/client";
import {
  getWhatsAppProvider,
  handleInbound,
  parseWhatsAppWebhook,
  verifyMetaSignature,
} from "@/modules/notifications";

/**
 * Webhook da WhatsApp Cloud API (só na raiz: o proxy não expõe /api nos tenants).
 * GET  verificação da assinatura do webhook (hub.challenge).
 * POST mensagens recebidas: assinatura X-Hub-Signature-256 obrigatória.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    token &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === token
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return new Response("Webhook não configurado", { status: 503 });

  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Assinatura inválida", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const db = getDb();
  const whatsapp = getWhatsAppProvider();
  let failed = false;
  for (const event of parseWhatsAppWebhook(body)) {
    try {
      await handleInbound(db, whatsapp, event, body);
    } catch (e) {
      failed = true;
      console.error("[webhook whatsapp] falhou", event.id, e);
    }
  }
  // 500 faz a Meta reenviar; reenvio é seguro (cada mensagem é processada uma vez).
  return new Response(failed ? "erro" : "ok", { status: failed ? 500 : 200 });
}
