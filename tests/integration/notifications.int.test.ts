/**
 * Etapa 8: confirmação e lembretes (janelas, idempotência, canais, consentimento)
 * e respostas pelo WhatsApp (botões e PARAR).
 * Datas em 2035 para não cruzar com reservas de outros arquivos de teste.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import {
  ConsoleEmailProvider,
  ConsoleWhatsAppProvider,
  handleInbound,
  listDueNotifications,
  processDueNotifications,
  type WhatsAppProvider,
} from "@/modules/notifications";
import { withTenant } from "@/modules/tenancy/context";
import { appDb, createTenantFixture, type TenantFixture } from "./fixtures";

const H = 3_600_000;
let db: Db;
let pool: Pool;
let T: TenantFixture;
let customerUser: { id: string; email: string };
let slot = 0;
/** Cada teste ganha um início próprio (dias diferentes em 2035). */
const nextStart = () => new Date(Date.UTC(2035, 4, 1 + slot++ * 3, 15));

async function booking(opts: {
  start: Date;
  changedAt: Date;
  phone?: string | null;
  optIn?: boolean;
  withUser?: boolean;
  status?: "CONFIRMED" | "CANCELLED";
}) {
  return withTenant(db, T.tenantId, async (tx) => {
    const [p] = await tx
      .insert(s.customerProfiles)
      .values({
        tenantId: T.tenantId,
        name: "Bruno Alves",
        phone: opts.phone ?? null,
        email: opts.withUser ? null : `perfil-${randomUUID().slice(0, 6)}@teste.dev`,
        whatsappOptInAt: opts.optIn ? new Date() : null,
      })
      .returning();
    const [b] = await tx
      .insert(s.bookings)
      .values({
        tenantId: T.tenantId,
        customerProfileId: p.id,
        customerId: opts.withUser ? customerUser.id : null,
        resourceId: T.resourceIds[1],
        offeringId: T.offeringId,
        period: { start: opts.start, end: new Date(opts.start.getTime() + 0.5 * H) },
        status: opts.status ?? "CONFIRMED",
        priceCents: 4500,
        source: "TENANT_PAGE",
        periodChangedAt: opts.changedAt,
      })
      .returning();
    return b;
  });
}

const dueFor = async (bookingId: string, now: Date) =>
  (await listDueNotifications(db, now, 1000))
    .filter((r) => r.booking_id === bookingId)
    .map((r) => r.kind);

const logs = (bookingId: string) =>
  withTenant(db, T.tenantId, (tx) =>
    tx.select().from(s.notificationLog).where(eq(s.notificationLog.bookingId, bookingId)),
  );

beforeAll(async () => {
  ({ db, pool } = appDb(10));
  T = await createTenantFixture(db);
  const [u] = await db
    .insert(s.users)
    .values({ name: "Bruno Alves", email: `bruno-${randomUUID().slice(0, 6)}@teste.dev` })
    .returning();
  customerUser = { id: u.id, email: u.email };
});
afterAll(() => pool.end());

describe("janelas de envio", () => {
  it("marcado com antecedência: confirmação na hora, lembrete 24h e 2h nas janelas certas", async () => {
    const start = nextStart();
    const created = new Date(start.getTime() - 72 * H);
    const b = await booking({ start, changedAt: created });

    expect(await dueFor(b.id, new Date(created.getTime() + 60_000))).toEqual(["CONFIRMATION"]);
    expect(await dueFor(b.id, new Date(start.getTime() - 30 * H))).toEqual([]);
    expect(await dueFor(b.id, new Date(start.getTime() - 23 * H))).toEqual(["REMINDER_24H"]);
    expect(await dueFor(b.id, new Date(start.getTime() - 3 * H))).toEqual(["REMINDER_24H"]);
    expect(await dueFor(b.id, new Date(start.getTime() - 1 * H))).toEqual(["REMINDER_2H"]);
    expect(await dueFor(b.id, new Date(start.getTime() - 10 * 60_000))).toEqual([]); // tarde demais
  });

  it("marcado em cima da hora (5h antes): confirmação e lembrete de 2h, sem o de 24h", async () => {
    const start = nextStart();
    const created = new Date(start.getTime() - 5 * H);
    const b = await booking({ start, changedAt: created });
    expect(await dueFor(b.id, new Date(created.getTime() + 60_000))).toEqual(["CONFIRMATION"]);
    expect(await dueFor(b.id, new Date(start.getTime() - 90 * 60_000))).toEqual([
      "CONFIRMATION",
      "REMINDER_2H",
    ]);
  });

  it("cancelado não recebe nada", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      status: "CANCELLED",
    });
    expect(await dueFor(b.id, new Date(start.getTime() - 23 * H))).toEqual([]);
  });
});

describe("envio", () => {
  const deps = (wa: WhatsAppProvider | null = new ConsoleWhatsAppProvider(true)) => ({
    whatsapp: wa,
    email: new ConsoleEmailProvider(true),
  });

  it("com consentimento vai por WhatsApp (template + botões); rodar de novo não duplica", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511999990000",
      optIn: true,
    });
    const now = new Date(start.getTime() - 23 * H);
    const d = deps();
    await processDueNotifications(db, { ...d, now });
    const wa = d.whatsapp as ConsoleWhatsAppProvider;
    const mine = wa.sent.filter((m) => m.template?.quickReplies.includes(`CONFIRM:${b.id}`));
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toBe("5511999990000");

    const [log] = await logs(b.id);
    expect(log).toMatchObject({
      kind: "REMINDER_24H",
      status: "SENT",
      channel: "WHATSAPP",
      recipient: "(11) 9****-0000",
    });

    await processDueNotifications(db, { ...d, now: new Date(now.getTime() + 60_000) });
    expect(
      wa.sent.filter((m) => m.template?.quickReplies.includes(`CONFIRM:${b.id}`)),
    ).toHaveLength(1);
  });

  it("sem consentimento, o telefone é ignorado e vai por e-mail", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511988887777",
      optIn: false,
    });
    const d = deps();
    await processDueNotifications(db, { ...d, now: new Date(start.getTime() - 23 * H) });
    expect((d.whatsapp as ConsoleWhatsAppProvider).sent.some((m) => m.to === "5511988887777")).toBe(
      false,
    );
    const [log] = await logs(b.id);
    expect(log).toMatchObject({ status: "SENT", channel: "EMAIL" });
    expect(d.email.outbox.at(-1)?.subject).toMatch(/^Lembrete:/);
  });

  it("WhatsApp falhou: cai para o e-mail e registra o erro", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511977776666",
      optIn: true,
    });
    const broken: WhatsAppProvider = {
      sendTemplate: async () => {
        throw new Error("template não aprovado");
      },
      sendText: async () => ({ id: "x" }),
    };
    const d = deps(broken);
    await processDueNotifications(db, { ...d, now: new Date(start.getTime() - 23 * H) });
    const [log] = await logs(b.id);
    expect(log).toMatchObject({ status: "SENT", channel: "EMAIL" });
    expect(log.error).toContain("template não aprovado");
  });

  it("três workers ao mesmo tempo: cada mensagem sai uma vez só", async () => {
    const start = nextStart();
    const changedAt = new Date(start.getTime() - 48 * H);
    const ids = [
      (await booking({ start, changedAt, phone: "5511966665555", optIn: true })).id,
      (
        await booking({
          start: new Date(start.getTime() + H),
          changedAt,
          phone: "5511966665555",
          optIn: true,
        })
      ).id,
    ];
    const wa = new ConsoleWhatsAppProvider(true);
    const now = new Date(start.getTime() - 22 * H);
    await Promise.all(
      [1, 2, 3].map(() =>
        processDueNotifications(db, { whatsapp: wa, email: new ConsoleEmailProvider(true), now }),
      ),
    );
    for (const id of ids) {
      expect(
        wa.sent.filter((m) => m.template?.quickReplies.includes(`CONFIRM:${id}`)),
      ).toHaveLength(1);
    }
  });

  it("horário novo (remarcação) ganha confirmação nova; o registro antigo não bloqueia", async () => {
    const start = nextStart();
    const b = await booking({ start, changedAt: new Date(start.getTime() - 48 * H) });
    await processDueNotifications(db, { ...deps(), now: new Date(start.getTime() - 47 * H) });
    expect((await logs(b.id)).map((l) => l.kind)).toEqual(["CONFIRMATION"]);

    // Mesmo efeito da remarcação do painel (que grava period_changed_at; ver panel.ts).
    const newStart = new Date(start.getTime() + 2 * H);
    await withTenant(db, T.tenantId, (tx) =>
      tx
        .update(s.bookings)
        .set({
          period: { start: newStart, end: new Date(newStart.getTime() + 0.5 * H) },
          periodChangedAt: new Date(start.getTime() - 40 * H),
        })
        .where(eq(s.bookings.id, b.id)),
    );
    expect(await dueFor(b.id, new Date(start.getTime() - 39 * H))).toEqual(["CONFIRMATION"]);
  });
});

describe("respostas pelo WhatsApp", () => {
  const event = (from: string, payload: string) => ({
    id: `wamid.${randomUUID()}`,
    from,
    kind: "button" as const,
    payload,
  });

  it("'Confirmo presença' do telefone da reserva (mesmo sem o 9º dígito) grava a presença e responde", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511987654321",
      optIn: true,
    });
    const wa = new ConsoleWhatsAppProvider(true);
    const e = event("551187654321", `CONFIRM:${b.id}`); // WhatsApp devolveu sem o 9
    expect(await handleInbound(db, wa, e, {}, new Date(start.getTime() - 20 * H))).toBe(
      "CONFIRMED",
    );
    const [row] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.bookings).where(eq(s.bookings.id, b.id)),
    );
    expect(row.customerConfirmedAt).not.toBeNull();
    expect(wa.sent.at(-1)?.text).toMatch(/^Presença confirmada!/);

    // O mesmo evento reenviado pela Meta não é processado de novo.
    expect(await handleInbound(db, wa, e, {})).toBe("DUPLICATE");
  });

  it("outro telefone não confirma a reserva de ninguém", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511944443333",
      optIn: true,
    });
    expect(await handleInbound(db, null, event("5521911112222", `CONFIRM:${b.id}`), {})).toBe(
      "IGNORED",
    );
    const [row] = await withTenant(db, T.tenantId, (tx) =>
      tx.select().from(s.bookings).where(eq(s.bookings.id, b.id)),
    );
    expect(row.customerConfirmedAt).toBeNull();
  });

  it("'Preciso remarcar' responde com o link da reserva", async () => {
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone: "5511933332222",
      optIn: true,
    });
    const wa = new ConsoleWhatsAppProvider(true);
    expect(await handleInbound(db, wa, event("5511933332222", `RESCHEDULE:${b.id}`), {})).toBe(
      "RESCHEDULE_LINK",
    );
    expect(wa.sent.at(-1)?.text).toContain(`/agendamento/${b.id}`);
  });

  it("PARAR tira o consentimento do telefone (conta e perfis)", async () => {
    const phone = "5511922221111";
    await db
      .update(s.users)
      .set({ phone, whatsappOptInAt: new Date() })
      .where(eq(s.users.id, customerUser.id));
    const start = nextStart();
    const b = await booking({
      start,
      changedAt: new Date(start.getTime() - 48 * H),
      phone,
      optIn: true,
    });
    const r = await handleInbound(
      db,
      null,
      { id: `wamid.${randomUUID()}`, from: phone, kind: "text", text: "Parar" },
      {},
    );
    expect(r).toBe("OPTED_OUT");
    const [u] = await db.select().from(s.users).where(eq(s.users.id, customerUser.id));
    expect(u.whatsappOptInAt).toBeNull();
    const [p] = await withTenant(db, T.tenantId, (tx) =>
      tx
        .select()
        .from(s.customerProfiles)
        .where(
          and(eq(s.customerProfiles.phone, phone), eq(s.customerProfiles.id, b.customerProfileId)),
        ),
    );
    expect(p.whatsappOptInAt).toBeNull();
    // E o próximo lembrete vai por e-mail.
    expect(
      (await listDueNotifications(db, new Date(start.getTime() - 23 * H), 1000)).find(
        (x) => x.booking_id === b.id,
      )?.phone,
    ).toBeNull();
  });

  it("texto qualquer é ignorado (sem robô respondendo)", async () => {
    const wa = new ConsoleWhatsAppProvider(true);
    expect(
      await handleInbound(
        db,
        wa,
        { id: `wamid.${randomUUID()}`, from: "5511900000000", kind: "text", text: "Oi, tudo bem?" },
        {},
      ),
    ).toBe("IGNORED");
    expect(wa.sent).toHaveLength(0);
  });
});
