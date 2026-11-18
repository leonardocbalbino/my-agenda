import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseWhatsAppWebhook } from "./inbound";
import { firstName, relativeWhen, renderNotification, type NotificationData } from "./messages";
import { CloudWhatsAppProvider, WhatsAppError, verifyMetaSignature } from "./whatsapp";

const SP = "America/Sao_Paulo";
const base: NotificationData = {
  bookingId: "11111111-2222-3333-4444-555555555555",
  kind: "REMINDER_24H",
  start: new Date("2026-11-07T21:30:00Z"), // sábado 18:30 em SP
  end: new Date("2026-11-07T22:20:00Z"),
  timezone: SP,
  tenantSlug: "navalha",
  tenantName: "Barbearia Navalha",
  offeringName: "Corte + barba",
  resourceName: "Rafa",
  customerName: "Bruno Alves",
};

describe("mensagens", () => {
  it("lembrete: parâmetros na ordem do template e botões com o id da reserva", () => {
    const m = renderNotification(base, new Date("2026-11-06T21:30:00Z"));
    expect(m.template).toMatchObject({
      name: "marcai_lembrete",
      language: "pt_BR",
      params: ["Bruno", "Barbearia Navalha", "Corte + barba", "Rafa", "amanhã às 18:30"],
      quickReplies: [`CONFIRM:${base.bookingId}`, `RESCHEDULE:${base.bookingId}`],
    });
    expect(m.text).toContain("Lembrete: amanhã às 18:30 você tem Corte + barba com Rafa");
    expect(m.text).toContain(`/agendamento/${base.bookingId}`);
    expect(m.subject).toBe("Lembrete: amanhã às 18:30 em Barbearia Navalha");
  });

  it("confirmação: data completa e sem botões", () => {
    const m = renderNotification({ ...base, kind: "CONFIRMATION" });
    expect(m.template.name).toBe("marcai_confirmacao");
    expect(m.template.params[4]).toBe("sábado, 7 de novembro, 18:30–19:20");
    expect(m.template.quickReplies).toEqual([]);
  });

  it("relativeWhen e firstName", () => {
    const now = new Date("2026-11-07T15:00:00Z");
    expect(relativeWhen(base.start, SP, now)).toBe("hoje às 18:30");
    expect(relativeWhen(base.start, SP, new Date("2026-11-04T15:00:00Z"))).toBe(
      "sábado, 7 de novembro, às 18:30",
    );
    expect(firstName("  Ana  Paula ")).toBe("Ana");
  });
});

describe("assinatura do webhook (X-Hub-Signature-256)", () => {
  const secret = "segredo-do-app";
  const body = '{"entry":[]}';
  const sign = (b: string, s = secret) =>
    `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("aceita a assinatura certa e recusa o resto", () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true);
    expect(verifyMetaSignature(body, sign(body, "outro"), secret)).toBe(false);
    expect(verifyMetaSignature(`${body} `, sign(body), secret)).toBe(false); // corpo alterado
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("WhatsApp Cloud API", () => {
  const config = { token: "tok", phoneNumberId: "123", apiVersion: "v99.0" };

  it("monta a chamada do template com parâmetros e botões", async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.X" }] }));
    const wa = new CloudWhatsAppProvider(config, fetchMock as unknown as typeof fetch);
    const r = await wa.sendTemplate("5511999990000", {
      name: "marcai_lembrete",
      language: "pt_BR",
      params: ["Bruno", "Navalha"],
      quickReplies: ["CONFIRM:1", "RESCHEDULE:1"],
    });
    expect(r.id).toBe("wamid.X");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v99.0/123/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "5511999990000",
      type: "template",
      template: {
        name: "marcai_lembrete",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Bruno" },
              { type: "text", text: "Navalha" },
            ],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: "CONFIRM:1" }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [{ type: "payload", payload: "RESCHEDULE:1" }],
          },
        ],
      },
    });
  });

  it("erro da API vira WhatsAppError com status e código", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { message: "Template não aprovado", code: 132001 } }, { status: 400 }),
    );
    const wa = new CloudWhatsAppProvider(config, fetchMock as unknown as typeof fetch);
    const err = await wa.sendText("5511999990000", "oi").catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toMatchObject({ status: 400, code: 132001, message: "Template não aprovado" });
  });
});

describe("leitura do webhook", () => {
  it("extrai botões (template e interativo) e textos; ignora status e lixo", () => {
    const events = parseWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.status", status: "delivered" }],
                messages: [
                  {
                    id: "m1",
                    from: "551199990000",
                    type: "button",
                    button: { payload: "CONFIRM:abc", text: "Confirmo" },
                  },
                  {
                    id: "m2",
                    from: "5511999990000",
                    type: "interactive",
                    interactive: { button_reply: { id: "RESCHEDULE:abc" } },
                  },
                  { id: "m3", from: "5511999990000", type: "text", text: { body: "PARAR" } },
                  { id: "m4", from: "5511999990000", type: "image", image: {} },
                  { from: "sem id", type: "text", text: { body: "x" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      { id: "m1", from: "551199990000", kind: "button", payload: "CONFIRM:abc" },
      { id: "m2", from: "5511999990000", kind: "button", payload: "RESCHEDULE:abc" },
      { id: "m3", from: "5511999990000", kind: "text", text: "PARAR" },
    ]);
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook({ entry: "x" })).toEqual([]);
  });
});
