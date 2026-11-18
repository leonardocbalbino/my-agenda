import path from "node:path";

export const E2E_PORT = 3100;
/** Domínio raiz dos testes: *.localhost resolve para 127.0.0.1 no Chromium. */
export const E2E_ROOT = `marcai.localhost:${E2E_PORT}`;
/** Onde o ConsoleEmailProvider grava os e-mails (links mágicos). */
export const OUTBOX = path.resolve("test-results/outbox");
/** Mensagens do WhatsApp (provedor de console) e segredos do webhook nos testes. */
export const WA_OUTBOX = path.resolve("test-results/whatsapp");
export const WA_APP_SECRET = "e2e-app-secret";
export const WA_VERIFY_TOKEN = "e2e-verify-token";
