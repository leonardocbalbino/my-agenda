import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Os workers herdam o ambiente deste processo (NEXT_PUBLIC_ROOT_DOMAIN, BETTER_AUTH_SECRET...).
if (existsSync(".env")) process.loadEnvFile(".env");

/** Testes contra Postgres real (banco marcai_test, recriado a cada execução). */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
