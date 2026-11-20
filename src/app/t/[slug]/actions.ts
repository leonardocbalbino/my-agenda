"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { parseISODate, zonedTime } from "@/lib/time";
import { signInUrl } from "@/lib/urls";
import {
  BookingError,
  cancelBookingByCustomer,
  createBooking,
  createRecurringBooking,
  scheduleExpiration,
} from "@/modules/booking";
import { getPublicCatalog } from "@/modules/catalog/public";
import { verifyRef } from "@/modules/marketplace/attribution";
import { getSessionUser, getTenant, REQUEST_URL_HEADER } from "@/modules/identity/guards";
import { disableWhatsAppReminders, enableWhatsAppReminders } from "@/modules/identity/profile";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.length > 0 && v.length < 100 ? v : null;
}

/**
 * O tenant vem do Host (gravado pelo proxy), nunca de um campo do formulário.
 * A URL original volta com ?erro=CODIGO quando algo falha.
 */
async function requestContext() {
  const h = await headers();
  const slug = h.get("x-marcai-tenant-slug");
  if (!slug) notFound();
  const tenant = await getTenant(slug);
  const url = new URL(h.get(REQUEST_URL_HEADER) ?? "http://invalido/");
  const back = (code: string) => {
    url.searchParams.set("erro", code);
    return `${url.pathname}${url.search}`;
  };
  return { tenant, url: url.toString(), back };
}

export async function confirmBooking(form: FormData) {
  const { tenant, url, back } = await requestContext();
  if (tenant.status !== "ACTIVE") redirect(back("SUSPENDED"));

  const user = await getSessionUser();
  if (!user) redirect(signInUrl(url));

  const offeringId = field(form, "servico");
  const resourceId = field(form, "recurso");
  const day = parseISODate(field(form, "dia") ?? "");
  const time = field(form, "hora");
  const recurring = field(form, "mensal") === "1";
  // Origem marketplace só com token assinado válido PARA ESTE tenant (define a comissão).
  const ref = form.get("ref");
  const source = verifyRef(typeof ref === "string" ? ref : null, tenant.tenantId)
    ? "MARKETPLACE"
    : "TENANT_PAGE";
  if (
    !offeringId ||
    !UUID.test(offeringId) ||
    (resourceId && !UUID.test(resourceId)) ||
    !day ||
    !time ||
    !/^\d{2}:\d{2}$/.test(time) ||
    (recurring && !resourceId)
  ) {
    redirect(back("INVALID_INPUT"));
  }

  const db = getDb();
  const catalog = await getPublicCatalog(db, tenant.tenantId);
  const start = zonedTime(day, time, catalog.location?.timezone ?? "America/Sao_Paulo");

  let bookingId: string;
  try {
    bookingId = recurring
      ? (
          await createRecurringBooking(
            db,
            tenant.tenantId,
            user,
            { offeringId, resourceId: resourceId!, start, source },
            { onPending: scheduleExpiration },
          )
        ).firstBookingId
      : (
          await createBooking(
            db,
            tenant.tenantId,
            user,
            { offeringId, resourceId, start, source },
            { onPending: scheduleExpiration },
          )
        ).id;
  } catch (e) {
    if (e instanceof BookingError) redirect(back(e.code));
    throw e;
  }
  redirect(`/agendamento/${bookingId}`);
}

export async function cancelBooking(form: FormData) {
  const { tenant, url, back } = await requestContext();
  const user = await getSessionUser();
  if (!user) redirect(signInUrl(url));

  const bookingId = field(form, "agendamento");
  if (!bookingId || !UUID.test(bookingId)) redirect(back("INVALID_INPUT"));

  try {
    await cancelBookingByCustomer(getDb(), tenant.tenantId, user.id, bookingId);
  } catch (e) {
    if (e instanceof BookingError) redirect(back(e.code));
    throw e;
  }
  redirect(`/agendamento/${bookingId}`);
}

/** Cliente ativa lembretes no WhatsApp (telefone + aceite explícito). */
export async function enableReminders(form: FormData) {
  const { url, back } = await requestContext();
  const user = await getSessionUser();
  if (!user) redirect(signInUrl(url));
  if (form.get("aceite") !== "on") redirect(back("CONSENT"));
  const ok = await enableWhatsAppReminders(getDb(), user.id, field(form, "telefone") ?? "");
  if (!ok) redirect(back("PHONE"));
  const target = new URL(url);
  target.searchParams.delete("erro");
  redirect(`${target.pathname}${target.search}`);
}

export async function disableReminders() {
  const { url } = await requestContext();
  const user = await getSessionUser();
  if (!user) redirect(signInUrl(url));
  await disableWhatsAppReminders(getDb(), user.id);
  const target = new URL(url);
  target.searchParams.delete("erro");
  redirect(`${target.pathname}${target.search}`);
}
