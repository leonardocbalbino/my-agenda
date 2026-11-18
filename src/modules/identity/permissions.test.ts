import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, canAccessResource, type Permission } from "./permissions";

const ownerOnly: Permission[] = [
  "page:manage",
  "settings:manage",
  "billing:manage",
  "payouts:manage",
];

describe("matriz de permissões", () => {
  it("OWNER pode tudo", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p)).toBe(true);
  });

  it("MANAGER: agenda, serviços, equipe, clientes e relatórios, mas não cobrança nem dados bancários", () => {
    for (const p of [
      "agenda:view_all",
      "agenda:manage_all",
      "catalog:manage",
      "team:manage",
      "customers:view",
      "reports:view",
    ] as const) {
      expect(can("MANAGER", p)).toBe(true);
    }
    for (const p of ownerOnly) expect(can("MANAGER", p)).toBe(false);
  });

  it("STAFF: só a própria agenda", () => {
    const granted = PERMISSIONS.filter((p) => can("STAFF", p));
    expect(granted.sort()).toEqual(["agenda:manage_own", "agenda:view_own"]);
  });

  it("toda permissão de dono-exclusivo é negada a quem não é dono", () => {
    for (const p of ownerOnly) {
      expect(can("STAFF", p)).toBe(false);
      expect(can("MANAGER", p)).toBe(false);
    }
  });
});

describe("canAccessResource", () => {
  const RAFA = "res-rafa";
  const DIEGO = "res-diego";

  it("STAFF vê e mexe só no próprio recurso", () => {
    const staff = { role: "STAFF" as const, resourceId: DIEGO };
    expect(canAccessResource(staff, DIEGO, "view")).toBe(true);
    expect(canAccessResource(staff, DIEGO, "manage")).toBe(true);
    expect(canAccessResource(staff, RAFA, "view")).toBe(false);
    expect(canAccessResource(staff, RAFA, "manage")).toBe(false);
  });

  it("STAFF sem recurso vinculado não acessa nada", () => {
    expect(canAccessResource({ role: "STAFF", resourceId: null }, RAFA, "view")).toBe(false);
  });

  it.each(["OWNER", "MANAGER"] as const)("%s acessa qualquer recurso", (role) => {
    expect(canAccessResource({ role, resourceId: null }, RAFA, "manage")).toBe(true);
  });
});
