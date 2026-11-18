/**
 * Tabelas do TENANT. Todas têm `tenant_id` e ficam sob Row Level Security
 * (policies em drizzle/*_security.sql). Referências entre elas usam FK composta
 * (tenant_id, x_id) -> (tenant_id, id): o banco impede apontar para linha de outro tenant.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { geographyPoint, tstzrange } from "../custom-types";
import {
  notificationChannelEnum,
  notificationKindEnum,
  notificationStatusEnum,
  bookingSourceEnum,
  bookingStatusEnum,
  exceptionKindEnum,
  membershipRoleEnum,
  nicheEnum,
  offeringModeEnum,
  paymentMethodEnum,
  paymentPolicyEnum,
  paymentStatusEnum,
  recurringStatusEnum,
  resourceKindEnum,
  subscriptionStatusEnum,
  tenantStatusEnum,
} from "./enums";
import { plans, timestamps, users } from "./platform";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 63 }).notNull().unique(),
    name: text("name").notNull(),
    niche: nicheEnum("niche").notNull(),
    brandColor: varchar("brand_color", { length: 7 }).default("#0F766E").notNull(),
    logoUrl: text("logo_url"),
    planId: uuid("plan_id").references(() => plans.id),
    listedOnMarketplace: boolean("listed_on_marketplace").default(false).notNull(),
    status: tenantStatusEnum("status").default("ACTIVE").notNull(),
    ...timestamps,
  },
  (t) => [
    check("tenants_slug_format", sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`),
    check(
      "tenants_slug_reserved",
      sql`${t.slug} not in ('www', 'admin', 'api', 'app', 'painel', 'explorar', 'static', 'mail')`,
    ),
    check("tenants_brand_color_hex", sql`${t.brandColor} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

/** Host próprio (subdomínio ou domínio customizado) -> tenant. */
export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    host: varchar("host", { length: 253 }).notNull().unique(),
    verified: boolean("verified").default(false).notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    verificationToken: text("verification_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("domains_host_lower", sql`${t.host} = lower(${t.host})`),
    index("domains_tenant_idx").on(t.tenantId),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    street: text("street").notNull(),
    number: varchar("number", { length: 20 }),
    complement: text("complement"),
    neighborhood: text("neighborhood").notNull(),
    city: text("city").notNull(),
    stateCode: varchar("state_code", { length: 2 }).notNull(),
    postalCode: varchar("postal_code", { length: 9 }),
    geo: geographyPoint("geo"),
    /** IANA. Tudo é gravado em UTC; o fuso só é usado para regras locais e exibição. */
    timezone: text("timezone").default("America/Sao_Paulo").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("locations_tenant_id_id_key").on(t.tenantId, t.id),
    index("locations_geo_idx").using("gist", t.geo),
  ],
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    locationId: uuid("location_id").notNull(),
    kind: resourceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("resources_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "resources_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }),
  ],
);

export const offerings = pgTable(
  "offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    mode: offeringModeEnum("mode").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** SERVICE: duração fixa do atendimento. */
    durationMinutes: integer("duration_minutes"),
    /** RENTAL: tamanho do slot do recurso (ex. 60 min). */
    slotMinutes: integer("slot_minutes"),
    basePriceCents: integer("base_price_cents").notNull(),
    paymentPolicy: paymentPolicyEnum("payment_policy").default("ON_SITE").notNull(),
    /** Sinal em basis points do preço (5000 = 50%). Usado quando payment_policy = DEPOSIT. */
    depositBps: integer("deposit_bps").default(5000).notNull(),
    allowRecurring: boolean("allow_recurring").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("offerings_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "offerings_mode_duration",
      sql`(${t.mode} = 'SERVICE' and ${t.durationMinutes} > 0)
       or (${t.mode} = 'RENTAL' and ${t.slotMinutes} > 0)`,
    ),
    check("offerings_price_nonneg", sql`${t.basePriceCents} >= 0`),
    check("offerings_deposit_range", sql`${t.depositBps} between 0 and 10000`),
  ],
);

/** Quais recursos executam a oferta ("Corte" -> Rafa, Diego; "Society" -> Society 1, 2). */
export const offeringResources = pgTable(
  "offering_resources",
  {
    tenantId: tenantId(),
    offeringId: uuid("offering_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "offering_resources_pkey", columns: [t.offeringId, t.resourceId] }),
    foreignKey({
      name: "offering_resources_offering_fk",
      columns: [t.tenantId, t.offeringId],
      foreignColumns: [offerings.tenantId, offerings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "offering_resources_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }).onDelete("cascade"),
    index("offering_resources_resource_idx").on(t.resourceId),
  ],
);

/** Jornada semanal por recurso, em hora LOCAL da Location (end_time pode ser 24:00). */
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    resourceId: uuid("resource_id").notNull(),
    /** 0 = domingo ... 6 = sábado */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
  },
  (t) => [
    foreignKey({
      name: "availability_rules_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }).onDelete("cascade"),
    check("availability_rules_weekday", sql`${t.weekday} between 0 and 6`),
    check("availability_rules_interval", sql`${t.endTime} > ${t.startTime}`),
    index("availability_rules_resource_idx").on(t.resourceId, t.weekday),
  ],
);

/** Folgas, feriados, fechamentos (CLOSED) ou aberturas extras (OPEN), em UTC. */
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    locationId: uuid("location_id").notNull(),
    /** Nulo = vale para a Location inteira. */
    resourceId: uuid("resource_id"),
    kind: exceptionKindEnum("kind").default("CLOSED").notNull(),
    period: tstzrange("period").notNull(),
    reason: text("reason"),
  },
  (t) => [
    foreignKey({
      name: "availability_exceptions_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "availability_exceptions_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }).onDelete("cascade"),
    index("availability_exceptions_period_idx").using("gist", t.tenantId, t.period),
  ],
);

/** Preço por faixa ("horário nobre a partir das 18h"), dia da semana e feriado. */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    offeringId: uuid("offering_id").notNull(),
    /** Nulo = vale para todos os recursos da oferta. */
    resourceId: uuid("resource_id"),
    label: text("label"),
    /** Nulo = todos os dias. 0 = domingo ... 6 = sábado. */
    weekdays: smallint("weekdays").array(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    holidaysOnly: boolean("holidays_only").default(false).notNull(),
    priceCents: integer("price_cents").notNull(),
    /** Maior prioridade vence quando mais de uma regra casa. */
    priority: integer("priority").default(0).notNull(),
  },
  (t) => [
    foreignKey({
      name: "pricing_rules_offering_fk",
      columns: [t.tenantId, t.offeringId],
      foreignColumns: [offerings.tenantId, offerings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pricing_rules_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }).onDelete("cascade"),
    check("pricing_rules_interval", sql`${t.endTime} > ${t.startTime}`),
    check("pricing_rules_price_nonneg", sql`${t.priceCents} >= 0`),
    check("pricing_rules_weekdays", sql`${t.weekdays} <@ array[0,1,2,3,4,5,6]::smallint[]`),
  ],
);

/** Cliente na visão do tenant. Pode não ter conta (walk-in criado no painel). */
export const customerProfiles = pgTable(
  "customer_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    phone: varchar("phone", { length: 20 }),
    email: text("email"),
    notes: text("notes"),
    noShowCount: integer("no_show_count").default(0).notNull(),
    /** Consentimento para lembretes por WhatsApp no telefone acima. */
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("customer_profiles_tenant_id_id_key").on(t.tenantId, t.id),
    unique("customer_profiles_tenant_user_key").on(t.tenantId, t.userId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    /** Opcional: restringe o membro a uma unidade. */
    locationId: uuid("location_id"),
    /** STAFF: o recurso (agenda) que pertence a ele. */
    resourceId: uuid("resource_id"),
    ...timestamps,
  },
  (t) => [
    unique("memberships_tenant_user_key").on(t.tenantId, t.userId),
    foreignKey({
      name: "memberships_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }),
    foreignKey({
      name: "memberships_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }),
    check("memberships_staff_resource", sql`${t.role} <> 'STAFF' or ${t.resourceId} is not null`),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** Mensalista: mesmo horário toda semana, cobrança mensal. Gera bookings concretos. */
export const recurringBookings = pgTable(
  "recurring_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    customerProfileId: uuid("customer_profile_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    offeringId: uuid("offering_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    status: recurringStatusEnum("status").default("ACTIVE").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("recurring_bookings_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "recurring_bookings_customer_fk",
      columns: [t.tenantId, t.customerProfileId],
      foreignColumns: [customerProfiles.tenantId, customerProfiles.id],
    }),
    foreignKey({
      name: "recurring_bookings_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }),
    foreignKey({
      name: "recurring_bookings_offering_fk",
      columns: [t.tenantId, t.offeringId],
      foreignColumns: [offerings.tenantId, offerings.id],
    }),
    check("recurring_bookings_weekday", sql`${t.weekday} between 0 and 6`),
    check("recurring_bookings_duration", sql`${t.durationMinutes} > 0`),
    check("recurring_bookings_price_nonneg", sql`${t.monthlyPriceCents} >= 0`),
  ],
);

/**
 * Reserva. A exclusion constraint `bookings_no_overlap` (SQL em drizzle/) impede
 * dois bookings ativos (PENDING_PAYMENT/CONFIRMED) no mesmo recurso e horário.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    customerProfileId: uuid("customer_profile_id").notNull(),
    /** Conta global do cliente (se tiver). Permite "Meus agendamentos" entre tenants. */
    customerId: uuid("customer_id").references(() => users.id, { onDelete: "set null" }),
    resourceId: uuid("resource_id").notNull(),
    offeringId: uuid("offering_id").notNull(),
    recurringBookingId: uuid("recurring_booking_id"),
    period: tstzrange("period").notNull(),
    status: bookingStatusEnum("status").default("CONFIRMED").notNull(),
    priceCents: integer("price_cents").notNull(),
    /** Valor a pagar online no ato (sinal ou integral); 0 = paga no local. */
    prepaidCents: integer("prepaid_cents").default(0).notNull(),
    source: bookingSourceEnum("source").notNull(),
    /** Só para PENDING_PAYMENT: um job cancela a reserva se o pagamento não cair até aqui. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Cliente confirmou presença (botão do lembrete no WhatsApp). */
    customerConfirmedAt: timestamp("customer_confirmed_at", { withTimezone: true }),
    /** Quando o horário atual foi definido (criação ou remarcação): base das janelas de lembrete. */
    periodChangedAt: timestamp("period_changed_at", { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("bookings_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "bookings_customer_profile_fk",
      columns: [t.tenantId, t.customerProfileId],
      foreignColumns: [customerProfiles.tenantId, customerProfiles.id],
    }),
    foreignKey({
      name: "bookings_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
    }),
    foreignKey({
      name: "bookings_offering_fk",
      columns: [t.tenantId, t.offeringId],
      foreignColumns: [offerings.tenantId, offerings.id],
    }),
    foreignKey({
      name: "bookings_recurring_fk",
      columns: [t.tenantId, t.recurringBookingId],
      foreignColumns: [recurringBookings.tenantId, recurringBookings.id],
    }),
    check("bookings_price_nonneg", sql`${t.priceCents} >= 0`),
    check("bookings_prepaid_range", sql`${t.prepaidCents} between 0 and ${t.priceCents}`),
    check(
      "bookings_pending_expires",
      sql`${t.status} <> 'PENDING_PAYMENT' or ${t.expiresAt} is not null`,
    ),
    check(
      "bookings_period_bounded",
      sql`not isempty(${t.period}) and lower_inc(${t.period}) and not upper_inc(${t.period})
          and not lower_inf(${t.period}) and not upper_inf(${t.period})`,
    ),
    index("bookings_tenant_period_idx").using("gist", t.tenantId, t.period),
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_pending_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'PENDING_PAYMENT'`),
  ],
);

/** Pagamento online de um booking ou mensalidade de mensalista (split no gateway). */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    bookingId: uuid("booking_id"),
    recurringBookingId: uuid("recurring_booking_id"),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").default("PENDING").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Parte retida pela plataforma via split. */
    platformFeeCents: integer("platform_fee_cents").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("payments_provider_payment_key").on(t.provider, t.providerPaymentId),
    foreignKey({
      name: "payments_booking_fk",
      columns: [t.tenantId, t.bookingId],
      foreignColumns: [bookings.tenantId, bookings.id],
    }),
    foreignKey({
      name: "payments_recurring_fk",
      columns: [t.tenantId, t.recurringBookingId],
      foreignColumns: [recurringBookings.tenantId, recurringBookings.id],
    }),
    check("payments_amount_positive", sql`${t.amountCents} > 0`),
    check("payments_fee_range", sql`${t.platformFeeCents} between 0 and ${t.amountCents}`),
    check(
      "payments_target",
      sql`(${t.bookingId} is not null) <> (${t.recurringBookingId} is not null)`,
    ),
  ],
);

/** Assinatura do SaaS (o tenant paga a plataforma). */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerSubscriptionId: text("provider_subscription_id"),
    status: subscriptionStatusEnum("status").default("TRIALING").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("subscriptions_tenant_idx").on(t.tenantId)],
);

/**
 * Registro de cada mensagem automática (confirmação e lembretes). A chave única
 * (reserva, tipo, horário) impede envio em dobro, inclusive com dois workers.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    bookingId: uuid("booking_id").notNull(),
    kind: notificationKindEnum("kind").notNull(),
    /** Início da reserva na hora do envio: remarcou, ganha lembretes novos. */
    bookingStart: timestamp("booking_start", { withTimezone: true }).notNull(),
    channel: notificationChannelEnum("channel").default("NONE").notNull(),
    status: notificationStatusEnum("status").default("SENDING").notNull(),
    /** Destinatário mascarado (minimização de dados). */
    recipient: text("recipient"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    unique("notification_log_once").on(t.bookingId, t.kind, t.bookingStart),
    foreignKey({
      name: "notification_log_booking_fk",
      columns: [t.tenantId, t.bookingId],
      foreignColumns: [bookings.tenantId, bookings.id],
    }).onDelete("cascade"),
    index("notification_log_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);
