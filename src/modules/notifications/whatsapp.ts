/**
 * WhatsApp atrás de uma interface: dá para trocar a Cloud API da Meta por outro
 * provedor (Twilio, Zenvia...) sem mexer em quem envia.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TemplateMessage } from "./messages";

export interface WhatsAppProvider {
  /** Mensagem iniciada pela empresa (exige template aprovado). */
  sendTemplate(to: string, template: TemplateMessage, preview?: string): Promise<{ id: string }>;
  /** Resposta livre: só dentro da janela de 24h após a última mensagem do cliente. */
  sendText(to: string, text: string): Promise<{ id: string }>;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Dev e testes: não envia nada; imprime e (opcionalmente) grava em arquivo. */
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  readonly sent: { to: string; template?: TemplateMessage; text: string }[] = [];
  private n = 0;

  constructor(
    private readonly silent = false,
    private readonly outboxDir = process.env.DEV_WHATSAPP_OUTBOX,
  ) {}

  private record(to: string, text: string, template?: TemplateMessage) {
    this.sent.push({ to, template, text });
    const id = `console-${Date.now()}-${++this.n}`;
    if (this.outboxDir) {
      mkdirSync(this.outboxDir, { recursive: true });
      writeFileSync(
        path.join(this.outboxDir, `${id}-${to}.json`),
        JSON.stringify({ to, template, text }, null, 2),
      );
    }
    if (!this.silent)
      console.info(
        `\n[whatsapp] para +${to}${template ? ` (template ${template.name})` : ""}\n${text}\n`,
      );
    return { id };
  }

  async sendTemplate(to: string, template: TemplateMessage, preview?: string) {
    return this.record(to, preview ?? template.params.join(" | "), template);
  }

  async sendText(to: string, text: string) {
    return this.record(to, text);
  }
}

export interface CloudConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  baseUrl?: string;
}

/** WhatsApp Cloud API (Meta Graph API). */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly config: CloudConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(body: unknown): Promise<{ id: string }> {
    const base = this.config.baseUrl ?? "https://graph.facebook.com";
    const res = await this.fetchImpl(
      `${base}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      throw new WhatsAppError(
        json.error?.message ?? `HTTP ${res.status}`,
        res.status,
        json.error?.code,
      );
    }
    return { id: json.messages[0].id };
  }

  sendTemplate(to: string, t: TemplateMessage) {
    const components: unknown[] = [
      { type: "body", parameters: t.params.map((text) => ({ type: "text", text })) },
      ...t.quickReplies.map((payload, index) => ({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload }],
      })),
    ];
    return this.post({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: t.name, language: { code: t.language }, components },
    });
  }

  sendText(to: string, text: string) {
    return this.post({ messaging_product: "whatsapp", to, type: "text", text: { body: text } });
  }
}

/** Confere o X-Hub-Signature-256 da Meta (HMAC-SHA256 do corpo cru com o App Secret). */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const globalForWa = globalThis as unknown as { __marcaiWhatsApp?: WhatsAppProvider | null };

/**
 * WHATSAPP_PROVIDER=cloud usa a Cloud API (exige WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * e WHATSAPP_API_VERSION). Sem isso: console em dev; nenhum (só e-mail) em produção.
 */
export function getWhatsAppProvider(): WhatsAppProvider | null {
  if (globalForWa.__marcaiWhatsApp !== undefined) return globalForWa.__marcaiWhatsApp;
  const { WHATSAPP_PROVIDER, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION } =
    process.env;
  if (WHATSAPP_PROVIDER === "cloud") {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_API_VERSION) {
      throw new Error(
        "WhatsApp Cloud API: defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_API_VERSION",
      );
    }
    globalForWa.__marcaiWhatsApp = new CloudWhatsAppProvider({
      token: WHATSAPP_TOKEN,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: WHATSAPP_API_VERSION,
    });
  } else if (WHATSAPP_PROVIDER === "console" || process.env.NODE_ENV !== "production") {
    globalForWa.__marcaiWhatsApp = new ConsoleWhatsAppProvider();
  } else {
    console.warn("[whatsapp] nenhum provedor configurado: lembretes só por e-mail");
    globalForWa.__marcaiWhatsApp = null;
  }
  return globalForWa.__marcaiWhatsApp;
}
