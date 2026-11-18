CREATE TYPE "public"."notification_channel" AS ENUM('WHATSAPP', 'EMAIL', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('CONFIRMATION', 'REMINDER_24H', 'REMINDER_2H');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('SENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"booking_start" timestamp with time zone NOT NULL,
	"channel" "notification_channel" DEFAULT 'NONE' NOT NULL,
	"status" "notification_status" DEFAULT 'SENDING' NOT NULL,
	"recipient" text,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_once" UNIQUE("booking_id","kind","booking_start")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "period_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_booking_fk" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_tenant_idx" ON "notification_log" USING btree ("tenant_id","created_at");