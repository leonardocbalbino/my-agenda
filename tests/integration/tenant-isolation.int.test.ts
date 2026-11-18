/**
 * Critério de aceite: um usuário do tenant A não lê (nem escreve) dados do
 * tenant B, MESMO com query sem filtro de tenant_id.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { withContext, withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, pgCode, type TenantFixture } from "./fixtures";

/** Tabelas com tenant_id que NÃO são isoladas por tenant, de propósito. */
const GLOBAL_WITH_TENANT_ID = ["audit_logs"];

let db: Db;
let pool: Pool;
let A: TenantFixture;
let B: TenantFixture;
let customerId: string;
let tenantTables: string[];

beforeAll(async () => {
  ({ db, pool } = appDb());
  const [customer] = await db
    .insert(s.users)
    .values({ name: "Cliente global", email: `cliente-${randomUUID().slice(0, 8)}@teste.dev` })
    .returning();
  customerId = customer.id;
  A = await createTenantFixture(db, { listed: true, customerUserId: customerId });
  B = await createTenantFixture(db, { listed: false, customerUserId: customerId });

  const rows = await db.execute<{ table_name: string }>(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.column_name = 'tenant_id'
    order by 1`);
  tenantTables = rows.rows
    .map((r) => r.table_name)
    .filter((t) => !GLOBAL_WITH_TENANT_ID.includes(t));
});

afterAll(() => pool.end());

const count = async (tx: Pick<Db, "execute">, query: string) =>
  Number((await tx.execute<{ n: string }>(sql.raw(query))).rows[0].n);

describe("configuração do banco", () => {
  it("a aplicação conecta com um papel sem superusuário e sem BYPASSRLS", async () => {
    const r = await db.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolname: "marcai_app", rolsuper: false, rolbypassrls: false });
  });

  it("toda tabela com tenant_id (e a tabela tenants) tem RLS ligado, FORÇADO e com policy", async () => {
    const r = await db.execute<{
      relname: string;
      rls: boolean;
      forced: boolean;
      policies: string;
    }>(
      sql`select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                 (select count(*) from pg_policies p where p.tablename = c.relname) as policies
          from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`,
    );
    const byName = new Map(r.rows.map((x) => [x.relname, x]));
    expect(tenantTables.length).toBeGreaterThanOrEqual(14);
    for (const t of [...tenantTables, "tenants"]) {
      const row = byName.get(t);
      expect({ t, rls: row?.rls, forced: row?.forced }).toEqual({ t, rls: true, forced: true });
      expect(Number(row?.policies), `policy em ${t}`).toBeGreaterThan(0);
    }
  });
});

describe("leitura", () => {
  it("com contexto do tenant A, SELECT sem filtro em cada tabela só devolve linhas de A", async () => {
    await withTenant(db, A.tenantId, async (tx) => {
      for (const t of tenantTables) {
        const total = await count(tx, `select count(*) as n from ${t}`);
        const foreign = await count(
          tx,
          `select count(*) as n from ${t} where tenant_id <> '${A.tenantId}'`,
        );
        expect({ t, foreign }).toEqual({ t, foreign: 0 });
        expect(total, `A deveria ver as próprias linhas em ${t}`).toBeGreaterThan(0);
      }
      expect(await count(tx, "select count(*) as n from tenants")).toBe(1);
    });
  });

  it("buscar uma linha de B pelo id, de dentro de A, não encontra nada", async () => {
    const found = await withTenant(db, A.tenantId, (tx) =>
      tx.execute(sql`select id from bookings where id = ${B.bookingId}`),
    );
    expect(found.rows).toHaveLength(0);
  });

  it("sem contexto de tenant, nenhuma linha de tenant é visível", async () => {
    for (const t of [...tenantTables, "tenants"]) {
      expect({ t, n: await count(db, `select count(*) as n from ${t}`) }).toEqual({ t, n: 0 });
    }
  });

  it("o contexto é local à transação e não vaza para a próxima query na mesma conexão", async () => {
    const single = appDb(1);
    try {
      await withTenant(single.db, A.tenantId, async () => {});
      expect(await count(single.db, "select count(*) as n from bookings")).toBe(0);
    } finally {
      await single.pool.end();
    }
  });
});

describe("escrita", () => {
  it("não insere linha com tenant_id de B estando no contexto de A", async () => {
    const err = await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.resources).values({
        tenantId: B.tenantId,
        locationId: B.locationId,
        kind: "PROFESSIONAL",
        name: "Intruso",
      }),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("42501"); // insufficient_privilege: viola a policy
  });

  it("UPDATE e DELETE sem filtro, de dentro de A, não tocam linhas de B", async () => {
    await withTenant(db, A.tenantId, async (tx) => {
      await tx.execute(sql`update offerings set base_price_cents = base_price_cents`);
      const del = await tx.execute(sql`delete from bookings where tenant_id = ${B.tenantId}`);
      expect(del.rowCount).toBe(0);
    });
    const stillThere = await withTenant(db, B.tenantId, (tx) =>
      tx.execute(sql`select id from bookings where id = ${B.bookingId}`),
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  it("não move uma linha de A para B via UPDATE de tenant_id", async () => {
    const err = await withTenant(db, A.tenantId, (tx) =>
      tx.execute(
        sql`update resources set tenant_id = ${B.tenantId} where id = ${A.resourceIds[0]}`,
      ),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("42501");
  });

  it("FK composta impede um booking de A apontar para recurso de B", async () => {
    const err = await withTenant(db, A.tenantId, (tx) =>
      tx.insert(s.bookings).values({
        tenantId: A.tenantId,
        customerProfileId: A.customerProfileId,
        resourceId: B.resourceIds[0],
        offeringId: A.offeringId,
        period: { start: new Date("2031-01-01T12:00:00Z"), end: new Date("2031-01-01T13:00:00Z") },
        priceCents: 4500,
        source: "PANEL",
      }),
    ).catch((e) => e);
    expect(pgCode(err)).toBe("23503"); // foreign_key_violation
  });
});

describe("acessos entre tenants permitidos de propósito", () => {
  it("public_listings mostra só tenants listados e não expõe colunas internas", async () => {
    const r = await db.execute<Record<string, unknown>>(
      sql`select * from public_listings where tenant_id in (${A.tenantId}, ${B.tenantId})`,
    );
    expect(r.rows.map((x) => x.tenant_id)).toEqual([A.tenantId]);
    expect(Object.keys(r.rows[0])).not.toContain("plan_id");
  });

  it("o cliente (conta global) lê os próprios bookings em A e B, sem contexto de tenant", async () => {
    const mine = await withContext(db, { tenantId: null, userId: customerId }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`select tenant_id from bookings order by tenant_id`),
    );
    expect(new Set(mine.rows.map((r) => r.tenant_id))).toEqual(new Set([A.tenantId, B.tenantId]));
  });

  it("...mas não consegue alterá-los sem o contexto do tenant", async () => {
    const upd = await withContext(db, { tenantId: null, userId: customerId }, (tx) =>
      tx.execute(sql`update bookings set status = 'CANCELLED' where customer_id = ${customerId}`),
    );
    expect(upd.rowCount).toBe(0);
  });

  it("outro usuário não vê os bookings desse cliente", async () => {
    const other = await withContext(db, { tenantId: null, userId: randomUUID() }, (tx) =>
      tx.execute(sql`select id from bookings`),
    );
    expect(other.rows).toHaveLength(0);
  });

  it("o usuário vê as próprias memberships em qualquer tenant (e só elas)", async () => {
    const r = await withContext(db, { tenantId: null, userId: A.userId }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`select tenant_id from memberships`),
    );
    expect(r.rows.map((x) => x.tenant_id)).toEqual([A.tenantId]);
  });
});
