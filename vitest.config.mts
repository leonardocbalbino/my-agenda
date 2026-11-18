import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Domínio fixo para os links gerados nos testes (o .env não é carregado aqui).
    env: { NEXT_PUBLIC_ROOT_DOMAIN: "marcai.test" },
  },
});
