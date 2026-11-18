import { describe, expect, it } from "vitest";
import { isTrustedRedirect } from "./redirects";

const ROOT = "marcai.com.br";
const ok = (v: string) => isTrustedRedirect(v, ROOT, "https");

describe("isTrustedRedirect", () => {
  it.each([
    "/",
    "/negocios",
    "/painel?dia=2026-11-06",
    "https://marcai.com.br/explorar",
    "https://navalha.marcai.com.br/painel",
    "https://admin.marcai.com.br/",
  ])("aceita %s", (v) => expect(ok(v)).toBe(true));

  it.each([
    "https://evil.example/",
    "//evil.example/x",
    "/\\evil.example/x",
    "http://navalha.marcai.com.br/painel", // protocolo rebaixado
    "https://marcai.com.br.evil.example/",
    "https://evilmarcai.com.br/",
    "https://a.b.marcai.com.br/",
    "https://user:pass@marcai.com.br/",
    "javascript:alert(1)",
    "data:text/html,oi",
    "não é url",
  ])("recusa %s", (v) => expect(ok(v)).toBe(false));

  it("domínio customizado ainda não é aceito (Etapa 10)", () => {
    expect(ok("https://barbearianavalha.com.br/")).toBe(false);
  });
});
