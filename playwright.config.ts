import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_ROOT, OUTBOX, WA_APP_SECRET, WA_OUTBOX, WA_VERIFY_TOKEN } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://${E2E_ROOT}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // A página do tenant é desenhada para 390px. Login roda só no desktop:
    // links mágicos são de uso único e os dois projetos usariam as mesmas contas.
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
      testIgnore: /auth-tenancy|booking|panel|reminders/,
    },
  ],
  webServer: {
    // NEXT_PUBLIC_* é embutido no build: o build precisa do domínio dos testes.
    command: `pnpm db:seed && pnpm build && pnpm start --port ${E2E_PORT}`,
    url: `http://${E2E_ROOT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      ENABLE_DESIGN_PAGE: "1",
      NEXT_PUBLIC_ROOT_DOMAIN: E2E_ROOT,
      DEV_EMAIL_OUTBOX: OUTBOX,
      WHATSAPP_PROVIDER: "console",
      DEV_WHATSAPP_OUTBOX: WA_OUTBOX,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
    },
  },
});
