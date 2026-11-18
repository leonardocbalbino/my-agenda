import { describe, expect, it } from "vitest";
import { adminPath, classifyHost, isInternalPath, tenantPath } from "./hosts";

const ROOT = "marcai.com.br";

describe("classifyHost", () => {
  it.each([
    ["marcai.com.br", { kind: "root" }],
    ["www.marcai.com.br", { kind: "root" }],
    ["MARCAI.com.br.", { kind: "root" }],
    ["admin.marcai.com.br", { kind: "admin" }],
    ["navalha.marcai.com.br", { kind: "subdomain", slug: "navalha" }],
    ["Arena-Beira-Rio.marcai.com.br", { kind: "subdomain", slug: "arena-beira-rio" }],
    ["barbearianavalha.com.br", { kind: "custom", host: "barbearianavalha.com.br" }],
    ["agenda.navalha.com.br:443", { kind: "custom", host: "agenda.navalha.com.br" }],
  ])("%s", (host, expected) => {
    expect(classifyHost(host, ROOT)).toEqual(expected);
  });

  it.each([
    [null],
    [""],
    ["a.b.marcai.com.br"], // subdomínio aninhado
    ["-navalha.marcai.com.br"],
    ["navalha_.marcai.com.br"],
    ["127.0.0.1"],
    ["10.0.0.1:3000"],
    ["evil.com/../x"],
  ])("rejeita %s", (host) => {
    expect(classifyHost(host, ROOT)).toEqual({ kind: "invalid" });
  });

  it("funciona com porta no domínio raiz (dev)", () => {
    const dev = "marcai.localhost:3000";
    expect(classifyHost("marcai.localhost:3000", dev)).toEqual({ kind: "root" });
    expect(classifyHost("navalha.marcai.localhost:3000", dev)).toEqual({
      kind: "subdomain",
      slug: "navalha",
    });
    expect(classifyHost("admin.marcai.localhost:3000", dev)).toEqual({ kind: "admin" });
  });

  it("um domínio parecido com a raiz não é tratado como subdomínio", () => {
    expect(classifyHost("navalhamarcai.com.br", ROOT)).toEqual({
      kind: "custom",
      host: "navalhamarcai.com.br",
    });
  });
});

describe("caminhos internos", () => {
  it.each(["/t", "/t/navalha", "/t/navalha/painel", "/admin", "/admin/tenants"])(
    "%s é interno",
    (p) => expect(isInternalPath(p)).toBe(true),
  );

  it.each(["/", "/tarifas", "/administracao", "/explorar", "/entrar"])("%s não é interno", (p) =>
    expect(isInternalPath(p)).toBe(false),
  );

  it("monta os caminhos de rewrite", () => {
    expect(tenantPath("navalha", "/")).toBe("/t/navalha");
    expect(tenantPath("navalha", "/painel")).toBe("/t/navalha/painel");
    expect(adminPath("/")).toBe("/admin");
    expect(adminPath("/tenants")).toBe("/admin/tenants");
  });
});
