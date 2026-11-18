/**
 * Etapa 3: resolução de tenant sem contexto, memberships e login por e-mail mágico.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { rootHostname, rootUrl, tenantUrl } from "@/lib/urls";
import { createAuth } from "@/modules/identity/auth";
import { isPlatformAdmin, listMyBusinesses, loadMembership } from "@/modules/identity/membership";
import { ConsoleEmailProvider } from "@/modules/notifications/email";
import { withTenant } from "@/modules/tenancy/context";
import {
  invalidateTenantCache,
  resolveTenantByHost,
  resolveTenantBySlug,
} from "@/modules/tenancy/resolve";
import { appDb, createTenantFixture, type TenantFixture } from "./fixtures";

let db: Db;
let pool: Pool;
let A: TenantFixture;
let B: TenantFixture;
let slugA: string;

beforeAll(async () => {
  ({ db, pool } = appDb());
  A = await createTenantFixture(db, { listed: true });
  B = await createTenantFixture(db);
  slugA = (await withTenant(db, A.tenantId, (tx) => tx.select().from(s.tenants)))[0].slug;
});
afterAll(() => pool.end());

describe("resolução de tenant (sem contexto, como marcai_app)", () => {
  it("por slug, sem diferenciar maiúsculas", async () => {
    invalidateTenantCache();
    const t = await resolveTenantBySlug(db, slugA.toUpperCase());
    expect(t).toMatchObject({ tenantId: A.tenantId, slug: slugA, status: "ACTIVE" });
  });

  it("slug inexistente devolve null", async () => {
    expect(await resolveTenantBySlug(db, "nao-existe-" + randomUUID().slice(0, 6))).toBeNull();
  });

  it("domínio customizado só resolve depois de verificado", async () => {
    const host = `agenda-${randomUUID().slice(0, 6)}.com.br`;
    await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.domains).values({ tenantId: A.tenantId, host, verified: false }),
    );
    invalidateTenantCache();
    expect(await resolveTenantByHost(db, host)).toBeNull();

    await withTenant(db, A.tenantId, (tx) =>
      tx.update(s.domains).set({ verified: true }).where(eq(s.domains.host, host)),
    );
    invalidateTenantCache();
    expect(await resolveTenantByHost(db, host.toUpperCase())).toMatchObject({
      tenantId: A.tenantId,
    });
  });

  it("devolve só campos públicos", async () => {
    const r = await db.execute(sql`select * from resolve_tenant_by_slug(${slugA})`);
    expect(Object.keys(r.rows[0]).sort()).toEqual([
      "brand_color",
      "name",
      "slug",
      "status",
      "tenant_id",
    ]);
  });

  it("a aplicação continua sem conseguir ler tenants diretamente", async () => {
    const r = await db.execute(sql`select count(*)::int as n from tenants`);
    expect(r.rows[0]).toEqual({ n: 0 });
  });
});

describe("memberships", () => {
  it("o dono de A tem membership em A e nenhuma em B", async () => {
    expect(await loadMembership(db, A.tenantId, A.userId)).toMatchObject({ role: "OWNER" });
    expect(await loadMembership(db, B.tenantId, A.userId)).toBeNull();
  });

  it("STAFF vem com o recurso dele", async () => {
    const [u] = await db
      .insert(s.users)
      .values({ name: "Diego", email: `staff-${randomUUID().slice(0, 8)}@teste.dev` })
      .returning();
    await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.memberships).values({
        tenantId: A.tenantId,
        userId: u.id,
        role: "STAFF",
        resourceId: A.resourceIds[1],
      }),
    );
    expect(await loadMembership(db, A.tenantId, u.id)).toMatchObject({
      role: "STAFF",
      resourceId: A.resourceIds[1],
    });
  });

  it("STAFF sem recurso é recusado pelo banco", async () => {
    const [u] = await db
      .insert(s.users)
      .values({ name: "Sem agenda", email: `staff-${randomUUID().slice(0, 8)}@teste.dev` })
      .returning();
    const err = await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.memberships).values({ tenantId: A.tenantId, userId: u.id, role: "STAFF" }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("'Seus negócios' lista só os tenants do usuário, com nome", async () => {
    const mine = await listMyBusinesses(db, A.userId);
    expect(mine).toEqual([
      expect.objectContaining({ tenantId: A.tenantId, slug: slugA, role: "OWNER" }),
    ]);
  });

  it("sem usuário no contexto, my_memberships() não devolve nada", async () => {
    const r = await db.execute(sql`select * from my_memberships()`);
    expect(r.rows).toHaveLength(0);
  });

  it("super admin vem de users.platform_role", async () => {
    expect(await isPlatformAdmin(db, A.userId)).toBe(false);
    await db.update(s.users).set({ platformRole: "SUPER_ADMIN" }).where(eq(s.users.id, B.userId));
    expect(await isPlatformAdmin(db, B.userId)).toBe(true);
  });
});

describe("login por e-mail mágico", () => {
  const email = new ConsoleEmailProvider(true);
  const auth = () => createAuth({ db, email, withNextCookies: false });
  const lastLink = () => {
    const msg = email.outbox.at(-1)!;
    return new URL(/https?:\/\/\S+/.exec(msg.text)![0]);
  };

  it("cria a conta global, devolve cookie no domínio raiz e volta para o subdomínio do tenant", async () => {
    const address = `Novo.${randomUUID().slice(0, 6)}@Teste.dev`;
    const callbackURL = tenantUrl(slugA, "/painel");

    await auth().api.signInMagicLink({
      body: { email: address, callbackURL },
      headers: new Headers(),
    });
    const link = lastLink();
    expect(email.outbox.at(-1)!.to.toLowerCase()).toBe(address.toLowerCase());
    expect(link.pathname).toBe("/api/auth/magic-link/verify");

    const res = await auth().api.magicLinkVerify({
      query: { token: link.searchParams.get("token")!, callbackURL },
      headers: new Headers(),
      asResponse: true,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(callbackURL);

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("marcai.session_token="));
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(
      new RegExp(`Domain=\\.?${rootHostname().replace(/\./g, "\\.")}`, "i"),
    );
    expect(setCookie).toMatch(/HttpOnly/i);

    const [user] = await db.select().from(s.users).where(eq(s.users.email, address.toLowerCase()));
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.emailVerified).toBe(true);
    expect(user.platformRole).toBeNull();

    const cookie = setCookie!.split(";")[0];
    const session = await auth().api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(user.id);

    // Campo de plataforma não pode ser definido pelo próprio usuário.
    await auth()
      .api.updateUser({
        body: { platformRole: "SUPER_ADMIN" } as never,
        headers: new Headers({ cookie }),
      })
      .catch(() => undefined);
    expect(await isPlatformAdmin(db, user.id)).toBe(false);
  });

  describe("open redirect (pelo endpoint HTTP, como um atacante faria)", () => {
    const origin = rootUrl("/").replace(/\/$/, "");
    const signIn = (callbackURL: string) =>
      auth().handler(
        new Request(rootUrl("/api/auth/sign-in/magic-link"), {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ email: `x-${randomUUID().slice(0, 6)}@teste.dev`, callbackURL }),
        }),
      );

    it.each([
      "https://evil.example/roubo",
      "//evil.example/roubo",
      `http://a.b.${"marcai.localhost:3000"}/x`,
      "javascript:alert(1)",
    ])("pedir link com callbackURL %s é recusado", async (cb) => {
      const sent = email.outbox.length;
      const res = await signIn(cb);
      expect(res.status).toBe(400);
      expect(email.outbox.length).toBe(sent); // nenhum e-mail sai
    });

    it.each([rootUrl("/"), tenantUrl("navalha", "/painel"), "/negocios"])(
      "callbackURL da própria plataforma é aceito: %s",
      async (cb) => {
        expect((await signIn(cb)).status).toBe(200);
      },
    );

    it("um link válido não redireciona para fora, mesmo com callbackURL adulterado", async () => {
      await signIn(rootUrl("/"));
      const token = lastLink().searchParams.get("token")!;
      const res = await auth().handler(
        new Request(
          rootUrl(
            `/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent("https://evil.example/x")}`,
          ),
        ),
      );
      expect(res.headers.get("location") ?? "").not.toContain("evil.example");
    });
  });

  it("o link só funciona uma vez", async () => {
    const address = `uma-vez-${randomUUID().slice(0, 6)}@teste.dev`;
    await auth().api.signInMagicLink({ body: { email: address }, headers: new Headers() });
    const token = lastLink().searchParams.get("token")!;
    const verify = () =>
      auth().api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
    const first = await verify();
    expect(first.headers.getSetCookie().some((c) => c.startsWith("marcai.session_token="))).toBe(
      true,
    );
    const second = await verify();
    expect(second.headers.getSetCookie().some((c) => c.startsWith("marcai.session_token="))).toBe(
      false,
    );
  });
});
