import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Envio de e-mail atrás de uma interface, para trocar o provider sem mexer em
 * quem envia. Na Etapa 8 entra um provider real; até lá, o console.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Desenvolvimento e testes: imprime no terminal e guarda em memória.
 * Com DEV_EMAIL_OUTBOX definido, também grava cada e-mail como JSON nessa pasta
 * (usado pelos testes e2e para abrir o link mágico). Nunca defina em produção.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly outbox: EmailMessage[] = [];

  constructor(
    private readonly silent = false,
    private readonly outboxDir = process.env.DEV_EMAIL_OUTBOX,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outboxDir) {
      mkdirSync(this.outboxDir, { recursive: true });
      const file = `${Date.now()}-${message.to.replace(/[^a-z0-9@._-]/gi, "_")}.json`;
      writeFileSync(path.join(this.outboxDir, file), JSON.stringify(message, null, 2));
    }
    if (!this.silent) {
      console.info(`\n[e-mail] para ${message.to}: ${message.subject}\n${message.text}\n`);
    }
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  provider ??= new ConsoleEmailProvider();
  return provider;
}
