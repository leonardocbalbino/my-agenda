CREATE TYPE "public"."booking_source" AS ENUM('MARKETPLACE', 'TENANT_PAGE', 'PANEL');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('CONFIRMED', 'PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."availability_exception_kind" AS ENUM('CLOSED', 'OPEN');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'MANAGER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."niche" AS ENUM('BARBERSHOP', 'SPORTS_VENUE', 'SALON', 'AESTHETICS', 'PET');--> statement-breakpoint
CREATE TYPE "public"."offering_mode" AS ENUM('SERVICE', 'RENTAL');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('PIX', 'CARD');--> statement-breakpoint
CREATE TYPE "public"."payment_policy" AS ENUM('ON_SITE', 'DEPOSIT', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'CONFIRMED', 'REFUNDED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('ACTIVE', 'PAUSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('PROFESSIONAL', 'SPACE', 'EQUIPMENT');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"tenant_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"state_code" varchar(2),
	"city" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"max_resources" integer,
	"platform_fee_bps" integer NOT NULL,
	"marketplace_fee_bps" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code"),
	CONSTRAINT "plans_price_nonneg" CHECK ("plans"."monthly_price_cents" >= 0),
	CONSTRAINT "plans_fees_range" CHECK ("plans"."platform_fee_bps" between 0 and 10000 and "plans"."marketplace_fee_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone" varchar(20),
	"platform_role" "platform_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_event_key" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"resource_id" uuid,
	"kind" "availability_exception_kind" DEFAULT 'CLOSED' NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"valid_from" date,
	"valid_until" date,
	CONSTRAINT "availability_rules_weekday" CHECK ("availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_interval" CHECK ("availability_rules"."end_time" > "availability_rules"."start_time")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"customer_id" uuid,
	"resource_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"recurring_booking_id" uuid,
	"period" "tstzrange" NOT NULL,
	"status" "booking_status" DEFAULT 'CONFIRMED' NOT NULL,
	"price_cents" integer NOT NULL,
	"prepaid_cents" integer DEFAULT 0 NOT NULL,
	"source" "booking_source" NOT NULL,
	"expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bookings_price_nonneg" CHECK ("bookings"."price_cents" >= 0),
	CONSTRAINT "bookings_prepaid_range" CHECK ("bookings"."prepaid_cents" between 0 and "bookings"."price_cents"),
	CONSTRAINT "bookings_pending_expires" CHECK ("bookings"."status" <> 'PENDING_PAYMENT' or "bookings"."expires_at" is not null),
	CONSTRAINT "bookings_period_bounded" CHECK (not isempty("bookings"."period") and lower_inc("bookings"."period") and not upper_inc("bookings"."period")
          and not lower_inf("bookings"."period") and not upper_inf("bookings"."period"))
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone" varchar(20),
	"email" text,
	"notes" text,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_profiles_tenant_user_key" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" varchar(253) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_host_unique" UNIQUE("host"),
	CONSTRAINT "domains_host_lower" CHECK ("domains"."host" = lower("domains"."host"))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"street" text NOT NULL,
	"number" varchar(20),
	"complement" text,
	"neighborhood" text NOT NULL,
	"city" text NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"postal_code" varchar(9),
	"geo" geography(Point,4326), -- drizzle-kit põe aspas em tipos com typmod; removidas à mão
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"location_id" uuid,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_staff_resource" CHECK ("memberships"."role" <> 'STAFF' or "memberships"."resource_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "offering_resources" (
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "offering_resources_pkey" PRIMARY KEY("offering_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" "offering_mode" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer,
	"slot_minutes" integer,
	"base_price_cents" integer NOT NULL,
	"payment_policy" "payment_policy" DEFAULT 'ON_SITE' NOT NULL,
	"deposit_bps" integer DEFAULT 5000 NOT NULL,
	"allow_recurring" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offerings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "offerings_mode_duration" CHECK (("offerings"."mode" = 'SERVICE' and "offerings"."duration_minutes" > 0)
       or ("offerings"."mode" = 'RENTAL' and "offerings"."slot_minutes" > 0)),
	CONSTRAINT "offerings_price_nonneg" CHECK ("offerings"."base_price_cents" >= 0),
	CONSTRAINT "offerings_deposit_range" CHECK ("offerings"."deposit_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid,
	"recurring_booking_id" uuid,
	"provider" varchar(32) NOT NULL,
	"provider_payment_id" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_key" UNIQUE("provider","provider_payment_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_fee_range" CHECK ("payments"."platform_fee_cents" between 0 and "payments"."amount_cents"),
	CONSTRAINT "payments_target" CHECK (("payments"."booking_id" is not null) <> ("payments"."recurring_booking_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"resource_id" uuid,
	"label" text,
	"weekdays" smallint[],
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"holidays_only" boolean DEFAULT false NOT NULL,
	"price_cents" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pricing_rules_interval" CHECK ("pricing_rules"."end_time" > "pricing_rules"."start_time"),
	CONSTRAINT "pricing_rules_price_nonneg" CHECK ("pricing_rules"."price_cents" >= 0),
	CONSTRAINT "pricing_rules_weekdays" CHECK ("pricing_rules"."weekdays" <@ array[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
CREATE TABLE "recurring_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"monthly_price_cents" integer NOT NULL,
	"status" "recurring_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_bookings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_bookings_weekday" CHECK ("recurring_bookings"."weekday" between 0 and 6),
	CONSTRAINT "recurring_bookings_duration" CHECK ("recurring_bookings"."duration_minutes" > 0),
	CONSTRAINT "recurring_bookings_price_nonneg" CHECK ("recurring_bookings"."monthly_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_subscription_id" text,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" text NOT NULL,
	"niche" "niche" NOT NULL,
	"brand_color" varchar(7) DEFAULT '#0F766E' NOT NULL,
	"logo_url" text,
	"plan_id" uuid,
	"listed_on_marketplace" boolean DEFAULT false NOT NULL,
	"status" "tenant_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "tenants_slug_reserved" CHECK ("tenants"."slug" not in ('www', 'admin', 'api', 'app', 'painel', 'explorar', 'static', 'mail')),
	CONSTRAINT "tenants_brand_color_hex" CHECK ("tenants"."brand_color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_profile_fk" FOREIGN KEY ("tenant_id","customer_profile_id") REFERENCES "public"."customer_profiles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offering_fk" FOREIGN KEY ("tenant_id","offering_id") REFERENCES "public"."offerings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_recurring_fk" FOREIGN KEY ("tenant_id","recurring_booking_id") REFERENCES "public"."recurring_bookings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offering_resources" ADD CONSTRAINT "offering_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offering_resources" ADD CONSTRAINT "offering_resources_offering_fk" FOREIGN KEY ("tenant_id","offering_id") REFERENCES "public"."offerings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offering_resources" ADD CONSTRAINT "offering_resources_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_fk" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recurring_fk" FOREIGN KEY ("tenant_id","recurring_booking_id") REFERENCES "public"."recurring_bookings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_offering_fk" FOREIGN KEY ("tenant_id","offering_id") REFERENCES "public"."offerings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_customer_fk" FOREIGN KEY ("tenant_id","customer_profile_id") REFERENCES "public"."customer_profiles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."resources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_offering_fk" FOREIGN KEY ("tenant_id","offering_id") REFERENCES "public"."offerings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "availability_exceptions_period_idx" ON "availability_exceptions" USING gist ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "availability_rules_resource_idx" ON "availability_rules" USING btree ("resource_id","weekday");--> statement-breakpoint
CREATE INDEX "bookings_tenant_period_idx" ON "bookings" USING gist ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_pending_expires_idx" ON "bookings" USING btree ("expires_at") WHERE "bookings"."status" = 'PENDING_PAYMENT';--> statement-breakpoint
CREATE INDEX "domains_tenant_idx" ON "domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "locations_geo_idx" ON "locations" USING gist ("geo");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offering_resources_resource_idx" ON "offering_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");