import { pgEnum } from "drizzle-orm/pg-core";
import { BOOKING_STATUSES } from "../../modules/booking/status";
import { NICHES } from "../../modules/catalog/niches";

export const nicheEnum = pgEnum("niche", NICHES);
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const bookingSourceEnum = pgEnum("booking_source", ["MARKETPLACE", "TENANT_PAGE", "PANEL"]);
export const resourceKindEnum = pgEnum("resource_kind", ["PROFESSIONAL", "SPACE", "EQUIPMENT"]);
export const offeringModeEnum = pgEnum("offering_mode", ["SERVICE", "RENTAL"]);
/** Como o cliente paga no ato do agendamento. */
export const paymentPolicyEnum = pgEnum("payment_policy", ["ON_SITE", "DEPOSIT", "FULL"]);
export const membershipRoleEnum = pgEnum("membership_role", ["OWNER", "MANAGER", "STAFF"]);
export const platformRoleEnum = pgEnum("platform_role", ["SUPER_ADMIN"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["ACTIVE", "SUSPENDED"]);
export const exceptionKindEnum = pgEnum("availability_exception_kind", ["CLOSED", "OPEN"]);
export const recurringStatusEnum = pgEnum("recurring_status", ["ACTIVE", "PAUSED", "CANCELLED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["PIX", "CARD"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "CONFIRMED",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "CONFIRMATION",
  "REMINDER_24H",
  "REMINDER_2H",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "WHATSAPP",
  "EMAIL",
  "NONE",
]);
export const notificationStatusEnum = pgEnum("notification_status", [
  "SENDING",
  "SENT",
  "FAILED",
  "SKIPPED",
]);
