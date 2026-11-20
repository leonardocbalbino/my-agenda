import { describe, expect, it } from "vitest";
import { REF_TTL_MS, signRef, verifyRef } from "./attribution";

const KEY = "chave-de-teste";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const NOW = 1_800_000_000_000;

describe("token de origem do marketplace", () => {
  const token = signRef(A, NOW, KEY);

  it("vale para o tenant certo dentro da validade", () => {
    expect(verifyRef(token, A, NOW + 60_000, KEY)).toBe(true);
    expect(token.length).toBeLessThan(150); // cabe na URL com folga
  });

  it("não vale em outro tenant", () => {
    expect(verifyRef(token, B, NOW, KEY)).toBe(false);
  });

  it("expira em 6h", () => {
    expect(verifyRef(token, A, NOW + REF_TTL_MS - 1, KEY)).toBe(true);
    expect(verifyRef(token, A, NOW + REF_TTL_MS + 1, KEY)).toBe(false);
  });

  it("não aceita token adulterado, de outra chave ou malformado", () => {
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(`${B}.${NOW + REF_TTL_MS}`).toString("base64url");
    expect(verifyRef(`${forged}.${sig}`, B, NOW, KEY)).toBe(false); // troca o tenant
    expect(verifyRef(`${payload}.${sig.slice(0, -2)}xx`, A, NOW, KEY)).toBe(false);
    expect(verifyRef(signRef(A, NOW, "outra-chave"), A, NOW, KEY)).toBe(false);
    for (const bad of [null, "", "marketplace", "a.b.c", "x".repeat(400), `${payload}.`]) {
      expect(verifyRef(bad, A, NOW, KEY)).toBe(false);
    }
  });
});
