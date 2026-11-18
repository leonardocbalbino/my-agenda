/**
 * Tabelas GLOBAIS (sem tenant_id, sem RLS por tenant): contas de usuário,
 * planos, feriados, eventos de webhook e auditoria da plataforma.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { platformRoleEnum } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Conta GLOBAL: um login para agendar em qualquer estabelecimento. Compatível com Better Auth. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    /** E.164 só dígitos ("5511999990000"). */
    phone: varchar("phone", { length: 20 }),
    /** Consentimento para lembretes por WhatsApp (LGPD). Nulo = não aceitou ou desistiu. */
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    platformRole: platformRoleEnum("platform_role"),
    ...timestamps,
  },
  (t) => [
    unique("users_email_key").on(t.email),
    check("users_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

/** Planos do SaaS. Comissões em basis points (100 bps = 1%), nunca float. */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    name: text("name").notNull(),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    maxResources: integer("max_resources"),
    /** % retida em pagamentos online vindos da página do tenant/painel. */
    platformFeeBps: integer("platform_fee_bps").notNull(),
    /** % retida quando source = MARKETPLACE (maior). */
    marketplaceFeeBps: integer("marketplace_fee_bps").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    check("plans_price_nonneg", sql`${t.monthlyPriceCents} >= 0`),
    check(
      "plans_fees_range",
      sql`${t.platformFeeBps} between 0 and 10000 and ${t.marketplaceFeeBps} between 0 and 10000`,
    ),
  ],
);

/** Feriados (nacionais quando state/city são nulos). Usados por PricingRule e disponibilidade. */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    stateCode: varchar("state_code", { length: 2 }),
    city: text("city"),
  },
  (t) => [index("holidays_date_idx").on(t.date)],
);

/** Idempotência de webhooks: o mesmo evento nunca é processado duas vezes. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 32 }).notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [unique("webhook_events_provider_event_key").on(t.provider, t.eventId)],
);

/** Trilha de auditoria (impersonate, mudanças de plano/comissão). Só INSERT/SELECT para a app. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    tenantId: uuid("tenant_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt)],
);

export { timestamps };

// --- Better Auth -------------------------------------------------------------
// Tabelas globais exigidas pelo Better Auth (nomes no plural; chaves TS em camelCase).

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    unique("accounts_provider_account_key").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
