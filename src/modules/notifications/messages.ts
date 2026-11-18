/**
 * Textos das mensagens automáticas (puro, testável).
 * No WhatsApp, mensagens iniciadas pela empresa precisam de TEMPLATE aprovado
 * pela Meta: aqui ficam o nome e os parâmetros na ordem do template. O texto
 * completo é usado no e-mail (fallback) e no provedor de console em dev.
 */
import { longPeriod } from "@/lib/format";
import { tenantUrl } from "@/lib/urls";

export type NotificationKind = "CONFIRMATION" | "REMINDER_24H" | "REMINDER_2H";

export interface NotificationData {
  bookingId: string;
  kind: NotificationKind;
  start: Date;
  end: Date;
  timezone: string;
  tenantSlug: string;
  tenantName: string;
  offeringName: string;
  resourceName: string;
  customerName: string;
}

export interface TemplateMessage {
  name: string;
  language: string;
  /** Parâmetros do corpo, na ordem {{1}}, {{2}}... */
  params: string[];
  /** Payloads dos botões de resposta rápida, na ordem do template. */
  quickReplies: string[];
}

export interface RenderedNotification {
  subject: string;
  text: string;
  template: TemplateMessage;
}

/**
 * Templates a cadastrar na Meta (categoria "Utilidade", idioma pt_BR):
 *
 * marcai_confirmacao
 *   Olá, {{1}}! Seu horário em {{2}} está confirmado: {{3}} com {{4}}, {{5}}.
 *
 * marcai_lembrete  (botões de resposta rápida: "Confirmo presença", "Preciso remarcar")
 *   Olá, {{1}}! Lembrete: {{5}} você tem {{3}} com {{4}} em {{2}}.
 */
export function templateNames() {
  return {
    confirmation: process.env.WHATSAPP_TEMPLATE_CONFIRMATION || "marcai_confirmacao",
    reminder: process.env.WHATSAPP_TEMPLATE_REMINDER || "marcai_lembrete",
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR",
  };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "tudo bem";

function clock(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** "amanhã às 18:30" / "hoje às 18:30" / "sábado, 7 de novembro, às 18:30". */
export function relativeWhen(start: Date, timeZone: string, now: Date): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  const at = `às ${clock(start, timeZone)}`;
  if (day(start) === day(now)) return `hoje ${at}`;
  if (day(start) === day(new Date(now.getTime() + 86_400_000))) return `amanhã ${at}`;
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(start);
  return `${date}, ${at}`;
}

export function renderNotification(d: NotificationData, now = new Date()): RenderedNotification {
  const names = templateNames();
  const who = firstName(d.customerName);
  const link = tenantUrl(d.tenantSlug, `/agendamento/${d.bookingId}`);

  if (d.kind === "CONFIRMATION") {
    const when = longPeriod(d.start, d.end, d.timezone);
    return {
      subject: `Agendamento confirmado em ${d.tenantName}`,
      text: [
        `Olá, ${who}! Seu horário em ${d.tenantName} está confirmado: ${d.offeringName} com ${d.resourceName}, ${when}.`,
        ``,
        `Ver, remarcar ou cancelar: ${link}`,
      ].join("\n"),
      template: {
        name: names.confirmation,
        language: names.language,
        params: [who, d.tenantName, d.offeringName, d.resourceName, when],
        quickReplies: [],
      },
    };
  }

  const when = relativeWhen(d.start, d.timezone, now);
  return {
    subject: `Lembrete: ${when} em ${d.tenantName}`,
    text: [
      `Olá, ${who}! Lembrete: ${when} você tem ${d.offeringName} com ${d.resourceName} em ${d.tenantName}.`,
      ``,
      `Precisa remarcar ou cancelar? ${link}`,
    ].join("\n"),
    template: {
      name: names.reminder,
      language: names.language,
      params: [who, d.tenantName, d.offeringName, d.resourceName, when],
      quickReplies: [`CONFIRM:${d.bookingId}`, `RESCHEDULE:${d.bookingId}`],
    },
  };
}
